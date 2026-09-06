import type { FindMeAvailability, FindMeResult } from '../../../shared/contracts'
import type { Env } from '../env'
import { getFaceProvider } from '../ai/faces/providerFactory'
import type { FaceEmbeddingProvider } from '../ai/faces/FaceEmbeddingProvider'
import { publicMediaByIds } from '../gallery/media'
import { HttpError, json, requireOrigin } from '../lib/http'
import { clientIp, rateLimit } from '../security/rateLimit'
import { readOperationalSettings } from '../settings'

type CalibrationRow = {
  id: string
  provider: string
  model: string
  model_version: string
  dimensions: number
  distance_metric: 'cosine' | 'euclidean' | 'dot-product'
  match_threshold: number
  strong_match_threshold: number
}

function maxImageBytes(env: Env) {
  const configured = Number(env.FIND_ME_MAX_IMAGE_BYTES)
  const value = Number.isFinite(configured) && configured > 0 ? configured : 6 * 1024 ** 2
  return Math.floor(Math.min(10 * 1024 ** 2, Math.max(256 * 1024, value)))
}

function sessionTtlSeconds(env: Env) {
  const configured = Number(env.SEARCH_SESSION_TTL_SECONDS)
  const value = Number.isFinite(configured) && configured > 0 ? configured : 600
  return Math.floor(Math.min(1_800, Math.max(120, value)))
}

async function activeCalibration(env: Env, provider: FaceEmbeddingProvider) {
  return env.DB.prepare(`SELECT id,provider,model,model_version,dimensions,distance_metric,match_threshold,strong_match_threshold
    FROM face_calibrations WHERE active=1 AND provider=? AND model=? AND model_version=? AND dimensions=? AND distance_metric=?
    ORDER BY updated_at DESC LIMIT 1`)
    .bind(provider.provider, provider.model, provider.modelVersion, provider.dimensions, provider.metric).first<CalibrationRow>()
}

async function availability(env: Env): Promise<{ public: FindMeAvailability; provider: FaceEmbeddingProvider | null; calibration: CalibrationRow | null }> {
  const settings = await readOperationalSettings(env)
  const base = { maxImageBytes: maxImageBytes(env), sessionTtlSeconds: sessionTtlSeconds(env) }
  if (settings.eventMode === 'archive' || !settings.aiEnabled || !settings.faceSearchEnabled) {
    return { public: { available: false, reason: 'disabled', ...base }, provider: null, calibration: null }
  }
  const provider = getFaceProvider(env)
  if (!provider) return { public: { available: false, reason: 'provider_unavailable', ...base }, provider: null, calibration: null }
  if (!env.FACE_INDEX) return { public: { available: false, reason: 'index_unavailable', provider: provider.provider, modelVersion: provider.modelVersion, ...base }, provider, calibration: null }
  const calibration = await activeCalibration(env, provider)
  if (!calibration) return { public: { available: false, reason: 'calibration_required', provider: provider.provider, modelVersion: provider.modelVersion, ...base }, provider, calibration: null }
  return { public: { available: true, provider: provider.provider, modelVersion: provider.modelVersion, ...base }, provider, calibration }
}

export async function findMeStatusRoute(request: Request, env: Env) {
  return json(request, env, (await availability(env)).public, 200, { 'Cache-Control': 'no-store' })
}

async function readLimitedImage(request: Request, limit: number) {
  const type = (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase()
  if (!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(type)) {
    throw new HttpError(415, 'SELFIE_TYPE_UNSUPPORTED', 'Choose a JPEG, PNG, WebP, or HEIC image.')
  }
  const declared = Number(request.headers.get('Content-Length') || 0)
  if (declared > limit) throw new HttpError(413, 'SELFIE_TOO_LARGE', 'Choose a selfie with a smaller file size.')
  if (!request.body) throw new HttpError(400, 'SELFIE_REQUIRED', 'Choose a selfie to search with.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel().catch(() => undefined)
        throw new HttpError(413, 'SELFIE_TOO_LARGE', 'Choose a selfie with a smaller file size.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  if (!length) throw new HttpError(400, 'SELFIE_REQUIRED', 'Choose a selfie to search with.')
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { bytes, mimeType: type }
}

async function faceMatches(env: Env, vectorIds: string[], calibration: CalibrationRow) {
  const rows: Array<{ embedding_vector_id: string; media_id: string; face_quality_score: number | null }> = []
  for (let offset = 0; offset < vectorIds.length; offset += 80) {
    const chunk = vectorIds.slice(offset, offset + 80)
    if (!chunk.length) continue
    const placeholders = chunk.map(() => '?').join(',')
    const result = await env.DB.prepare(`SELECT embedding_vector_id,media_id,face_quality_score FROM detected_faces
      WHERE deleted_at IS NULL AND embedding_provider=? AND embedding_model=? AND embedding_model_version=?
        AND embedding_dimensions=? AND distance_metric=? AND embedding_vector_id IN (${placeholders})`)
      .bind(calibration.provider,calibration.model,calibration.model_version,calibration.dimensions,calibration.distance_metric,...chunk)
      .all<{ embedding_vector_id: string; media_id: string; face_quality_score: number | null }>()
    rows.push(...result.results)
  }
  return new Map(rows.map((row) => [row.embedding_vector_id, row]))
}

export async function findMeSearchRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  if (request.headers.get('X-Find-Me-Consent') !== 'true') throw new HttpError(400, 'CONSENT_REQUIRED', 'Please confirm that you understand how the selfie search works.')
  const state = await availability(env)
  if (!state.public.available || !state.provider || !state.calibration || !env.FACE_INDEX) {
    throw new HttpError(503, 'FIND_ME_UNAVAILABLE', 'Find Me is currently unavailable. You can still browse every gallery memory.', true, { reason: state.public.reason })
  }
  await Promise.all([
    rateLimit(env, `find-me-ip:${clientIp(request)}`, 'find_me', 10, 600),
    rateLimit(env, 'find-me-global', 'find_me_global', 300, 600),
  ])
  const image = await readLimitedImage(request, state.public.maxImageBytes)
  let queryEmbedding: number[] | null = null
  try {
    const faces = await state.provider.analyseImage(image.bytes.buffer, image.mimeType)
    if (!faces.length) throw new HttpError(422, 'NO_FACE_FOUND', 'We could not find one clear face. Try another well-lit selfie.')
    if (faces.length > 1) throw new HttpError(422, 'MULTIPLE_FACES_FOUND', 'We found more than one person. For the best results, use a selfie with just you.')
    const face = faces[0]
    if (face.bounds.width * face.bounds.height < 0.08 || (face.quality !== null && face.quality < 0.4)) {
      throw new HttpError(422, 'SELFIE_QUALITY_LOW', 'Move closer and try again in clear, even light.')
    }
    queryEmbedding = face.embedding
    const configuredTopK = Number(env.FACE_QUERY_TOP_K)
    const topK = Math.floor(Math.min(100, Math.max(20, Number.isFinite(configuredTopK) && configuredTopK > 0 ? configuredTopK : 100)))
    const vectorResult = await env.FACE_INDEX.query(queryEmbedding, { topK, returnValues: false, returnMetadata: 'none' })
    const matchRows = await faceMatches(env, vectorResult.matches.map((match) => match.id), state.calibration)
    const mediaScores = new Map<string, { score: number; quality: number }>()
    for (const match of vectorResult.matches) {
      if (match.score < state.calibration.match_threshold) continue
      const row = matchRows.get(match.id)
      if (!row) continue
      const prior = mediaScores.get(row.media_id)
      const candidate = { score: match.score, quality: row.face_quality_score ?? 0 }
      if (!prior || candidate.score > prior.score || (candidate.score === prior.score && candidate.quality > prior.quality)) mediaScores.set(row.media_id, candidate)
    }
    const ranked = [...mediaScores.entries()].sort((left, right) => right[1].score - left[1].score || right[1].quality - left[1].quality).slice(0, 30)
    const media = await publicMediaByIds(env, ranked.map(([mediaId]) => mediaId), { requireFaceEnabled: true })
    const matches = ranked.map(([mediaId, score]) => {
      const item = media.get(mediaId)
      return item ? { ...item, similarity: score.score, matchStrength: score.score >= state.calibration!.strong_match_threshold ? 'strong' as const : 'possible' as const } : null
    }).filter((item): item is NonNullable<typeof item> => Boolean(item))
    const searchSessionId = crypto.randomUUID()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + state.public.sessionTtlSeconds * 1000).toISOString()
    await env.DB.prepare('INSERT INTO search_sessions(id,created_at,expires_at) VALUES(?,?,?)').bind(searchSessionId, now.toISOString(), expiresAt).run()
    const result: FindMeResult = {
      searchSessionId,
      expiresAt,
      strongMatches: matches.filter((item) => item.matchStrength === 'strong'),
      possibleMatches: matches.filter((item) => item.matchStrength === 'possible'),
      totalMatches: matches.length,
    }
    return json(request, env, result, 200, { 'Cache-Control': 'no-store', Pragma: 'no-cache' })
  } finally {
    image.bytes.fill(0)
    queryEmbedding?.fill(0)
    queryEmbedding = null
  }
}
