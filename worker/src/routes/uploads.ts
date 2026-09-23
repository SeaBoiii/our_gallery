import type { CompleteUploadRequest, EventSlug, PrepareUploadRequest, PreparedUpload, UploadRefreshResponse } from '../../../shared/contracts'
import type { Env } from '../env'
import { HttpError, json, parseJson, requireOrigin } from '../lib/http'
import { signedPut } from '../r2/signing'
import { verifiedObject } from '../r2/verify'
import { clientIp, guestSession, rateLimit } from '../security/rateLimit'
import { base64url, secureValueHash, textEncoder } from '../security/hash'
import { verifyTurnstile } from '../security/turnstile'
import { extensionForMime, validateUploadFile } from '../security/validation'
import { finalizeUpload, type FinalizableUploadRow } from '../uploads/finalize'
import { readGalleryPolicy } from '../lib/galleryVisibility'

type EventRow = { id: string; slug: EventSlug; event_date: string; display_name: string; upload_enabled: number }
type UploadRequestRow = { session_hash: string; intent_hash: string; status: 'preparing' | 'prepared'; expires_at: string }
type UploadRow = FinalizableUploadRow & {
  request_id: string
  client_id: string
  event_id: string
  event_date: string
  event_slug: EventSlug
  original_filename: string
  fingerprint: string
  intent_hash: string
  session_hash: string
  derivative_status: string
  upload_expires_at: string
  last_put_expires_at: string
  created_at: string
}

const MAX_UPLOAD_AUTHORIZATION_MS = 30 * 60 * 1000
const PREPARE_CLAIM_MS = 2 * 60 * 1000

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function configuredPutTtl(env: Env) { return Math.min(900, Math.max(60, Number(env.UPLOAD_URL_TTL_SECONDS) || 600)) }

async function intentHash(payload: PrepareUploadRequest) {
  const canonical = JSON.stringify({
    eventSlug: payload.eventSlug,
    guestName: payload.guestName?.trim() || null,
    guestMessage: payload.guestMessage?.trim() || null,
    files: [...payload.files].sort((left, right) => left.clientId.localeCompare(right.clientId)).map((file) => ({
      ...file,
      variants: [...file.variants].sort((left, right) => left.kind.localeCompare(right.kind)),
    })),
  })
  return base64url(await crypto.subtle.digest('SHA-256', textEncoder.encode(canonical)))
}

async function signRow(env: Env, row: UploadRow, ttlSeconds: number): Promise<PreparedUpload> {
  return {
    clientId: row.client_id,
    mediaId: row.id,
    original: await signedPut(env, row.staging_original_object_key, row.mime_type, ttlSeconds, row.upload_expires_at),
    display: row.staging_display_object_key ? await signedPut(env, row.staging_display_object_key, 'image/webp', ttlSeconds, row.upload_expires_at) : undefined,
    thumbnail: row.staging_thumbnail_object_key ? await signedPut(env, row.staging_thumbnail_object_key, 'image/webp', ttlSeconds, row.upload_expires_at) : undefined,
  }
}

async function uploadRowsByRequest(env: Env, requestId: string) {
  return env.DB.prepare(`SELECT m.*, e.event_date, e.slug AS event_slug FROM media m JOIN events e ON e.id = m.event_id WHERE m.request_id = ? ORDER BY m.client_id`).bind(requestId).all<UploadRow>()
}

async function updateLastPutExpiry(env: Env, requestId: string, expiresAt: string) {
  await env.DB.prepare("UPDATE media SET last_put_expires_at = ?, staging_purged_at = NULL WHERE request_id = ? AND status = 'uploading'").bind(expiresAt, requestId).run()
}

async function claimUploadRequest(env: Env, requestId: string, sessionHash: string, requestIntent: string) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + PREPARE_CLAIM_MS).toISOString()
  const claim = await env.DB.prepare(`INSERT INTO upload_requests (id, session_hash, intent_hash, status, created_at, expires_at)
    VALUES (?, ?, ?, 'preparing', ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(requestId, sessionHash, requestIntent, now.toISOString(), expiresAt).run()
  if (claim.meta.changes) return

  const existing = await env.DB.prepare('SELECT session_hash, intent_hash, status, expires_at FROM upload_requests WHERE id = ?').bind(requestId).first<UploadRequestRow>()
  if (existing?.status === 'preparing' && Date.parse(existing.expires_at) < now.getTime()) {
    const takeover = await env.DB.prepare(`UPDATE upload_requests SET session_hash = ?, intent_hash = ?, created_at = ?, expires_at = ?
      WHERE id = ? AND status = 'preparing' AND expires_at < ?`)
      .bind(sessionHash, requestIntent, now.toISOString(), expiresAt, requestId, now.toISOString()).run()
    if (takeover.meta.changes) return
  }
  if (!existing || existing.session_hash !== sessionHash || existing.intent_hash !== requestIntent) {
    throw new HttpError(409, 'REQUEST_ID_CONFLICT', 'Please begin this check-in again.')
  }
  throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'This check-in is still being prepared. Please try again in a moment.', true)
}

async function releaseUploadRequestClaim(env: Env, requestId: string, sessionHash: string, requestIntent: string) {
  await env.DB.prepare("DELETE FROM upload_requests WHERE id = ? AND session_hash = ? AND intent_hash = ? AND status = 'preparing'").bind(requestId, sessionHash, requestIntent).run()
}

export async function prepareUploadsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const payload = await parseJson<PrepareUploadRequest>(request)
  if (!validUuid(payload.requestId || '')) throw new HttpError(400, 'INVALID_REQUEST_ID', 'Please refresh and try again.')
  if (!['solemnisation', 'reception'].includes(payload.eventSlug)) throw new HttpError(400, 'INVALID_EVENT', 'Please choose a celebration.')
  if (!Array.isArray(payload.files) || payload.files.length < 1 || payload.files.length > 20) throw new HttpError(400, 'INVALID_BATCH', 'Choose between 1 and 20 memories.')
  if ((payload.guestName?.length || 0) > 80 || (payload.guestMessage?.length || 0) > 280) throw new HttpError(400, 'DETAILS_TOO_LONG', 'The guest name or message is too long.')
  payload.files.forEach(validateUploadFile)

  const session = guestSession(request)
  const sessionHash = await secureValueHash(env, session)
  const ip = clientIp(request)
  const declaredMib = Math.max(1, Math.ceil(payload.files.reduce((sum, file) => sum + file.size + file.variants.reduce((variantSum, variant) => variantSum + variant.size, 0), 0) / 1024 ** 2))
  await Promise.all([
    rateLimit(env, `ip:${ip}`, 'prepare', 1_200, 600),
    rateLimit(env, `session:${session}`, 'prepare', 8, 600),
    rateLimit(env, `ip:${ip}`, 'prepare_files', 12_000, 600, payload.files.length),
    rateLimit(env, `session:${session}`, 'prepare_files', 80, 600, payload.files.length),
    rateLimit(env, `ip:${ip}`, 'prepare_mib', 1_048_576, 600, declaredMib),
    rateLimit(env, `session:${session}`, 'prepare_mib', 6_144, 600, declaredMib),
  ])

  const [event, requestIntent] = await Promise.all([
    env.DB.prepare('SELECT id, slug, event_date, display_name, upload_enabled FROM events WHERE slug = ?').bind(payload.eventSlug).first<EventRow>(),
    intentHash(payload),
  ])

  const existing = await uploadRowsByRequest(env, payload.requestId)
  if (existing.results.length) {
    const conflicted = existing.results.length !== payload.files.length || existing.results.some((row) => row.session_hash !== sessionHash || row.status !== 'uploading' || row.event_slug !== payload.eventSlug || row.intent_hash !== requestIntent || !payload.files.some((file) => file.clientId === row.client_id))
    if (conflicted) throw new HttpError(409, 'REQUEST_ID_CONFLICT', 'Please begin this check-in again.')
    const authorizationRemaining = Math.floor(Math.min(...existing.results.map((row) => Date.parse(row.upload_expires_at))) - Date.now()) / 1000
    if (!Number.isFinite(authorizationRemaining) || authorizationRemaining < 15) {
      await env.DB.prepare("UPDATE media SET status = 'expired', deleted_at = ? WHERE request_id = ? AND status = 'uploading'").bind(new Date().toISOString(), payload.requestId).run()
      throw new HttpError(409, 'UPLOAD_AUTHORIZATION_EXPIRED', 'This check-in has expired. Please begin again.')
    }
    const ttl = Math.max(1, Math.min(configuredPutTtl(env), Math.floor(authorizationRemaining)))
    await updateLastPutExpiry(env, payload.requestId, new Date(Date.now() + ttl * 1000).toISOString())
    return json(request, env, { uploads: await Promise.all(existing.results.map((row) => signRow(env, row, ttl))) })
  }

  // A previously authorized request keeps its original day and retry window even
  // after visibility changes or global check-in closes. New requests use current policy.
  const policy = await readGalleryPolicy(env)
  if (!policy.uploadsEnabled) throw new HttpError(403, 'UPLOADS_CLOSED', 'Memory check-in is currently closed.')
  if (!event || !policy.slugs.includes(event.slug)) throw new HttpError(403, 'EVENT_UPLOADS_CLOSED', 'Memory check-in for this celebration is currently closed.')
  await claimUploadRequest(env, payload.requestId, sessionHash, requestIntent)
  let requestClaimPreparing = true
  try {
  await verifyTurnstile(env, payload.turnstileToken, ip)

  const hardLimitGb = Number(env.HARD_STORAGE_LIMIT_GB)
  if (Number.isFinite(hardLimitGb) && hardLimitGb > 0) {
    const storage = await env.DB.prepare("SELECT COALESCE(SUM(size_bytes + display_size_bytes + thumbnail_size_bytes), 0) AS total FROM media WHERE status NOT IN ('deleted','expired')").first<{ total: number }>()
    const incoming = payload.files.reduce((sum, file) => sum + file.size + file.variants.reduce((variantSum, variant) => variantSum + variant.size, 0), 0)
    if ((storage?.total || 0) + incoming > hardLimitGb * 1024 ** 3) throw new HttpError(507, 'STORAGE_LIMIT', 'Memory check-in is temporarily full. Please contact the couple.')
  }

  for (const file of payload.files) {
    const duplicate = await env.DB.prepare("SELECT id FROM media WHERE event_id = ? AND session_hash = ? AND fingerprint = ? AND status NOT IN ('deleted','expired') LIMIT 1").bind(event.id, sessionHash, file.fingerprint).first<{ id: string }>()
    if (duplicate) throw new HttpError(409, 'DUPLICATE_FILE', `${file.filename}: This memory has already been checked in for this celebration.`, false, { filename: file.filename })
  }

  // Turnstile/storage reads can span midnight or an admin change. Authorize again
  // after that asynchronous work, immediately before persisting this new batch.
  const currentPolicy = await readGalleryPolicy(env)
  if (!currentPolicy.uploadsEnabled) throw new HttpError(403, 'UPLOADS_CLOSED', 'Memory check-in is currently closed.')
  if (!currentPolicy.slugs.includes(event.slug)) throw new HttpError(403, 'EVENT_UPLOADS_CLOSED', 'Memory check-in for this celebration is currently closed.')
  const now = new Date()
  const ttl = configuredPutTtl(env)
  const authorizationExpiresAt = new Date(now.getTime() + MAX_UPLOAD_AUTHORIZATION_MS).toISOString()
  const lastPutExpiresAt = new Date(now.getTime() + ttl * 1000).toISOString()
  const rows: UploadRow[] = []
  const statements: D1PreparedStatement[] = []
  for (const file of payload.files) {
    const id = crypto.randomUUID()
    const extension = extensionForMime(file.mimeType)
    const stagingBase = `staging/${event.event_date}/${id}`
    const stagingOriginalKey = `${stagingBase}/original.${extension}`
    const originalKey = `originals/${event.event_date}/${id}/original.${extension}`
    const display = file.variants.find((variant) => variant.kind === 'display')
    const thumbnail = file.variants.find((variant) => variant.kind === 'thumbnail')
    const stagingDisplayKey = display ? `${stagingBase}/display.webp` : null
    const stagingThumbnailKey = thumbnail ? `${stagingBase}/thumbnail.webp` : null
    const displayKey = display ? `display/${event.event_date}/${id}.webp` : null
    const thumbnailKey = thumbnail ? `thumbnails/${event.event_date}/${id}.webp` : null
    const row: UploadRow = {
      id, request_id: payload.requestId, client_id: file.clientId, event_id: event.id, event_date: event.event_date, event_slug: event.slug, media_type: file.mediaType, mime_type: file.mimeType,
      staging_original_object_key: stagingOriginalKey, staging_display_object_key: stagingDisplayKey, staging_thumbnail_object_key: stagingThumbnailKey,
      original_object_key: originalKey, display_object_key: displayKey, thumbnail_object_key: thumbnailKey, original_filename: file.filename, fingerprint: file.fingerprint, intent_hash: requestIntent,
      size_bytes: file.size, display_size_bytes: display?.size || 0, thumbnail_size_bytes: thumbnail?.size || 0, session_hash: sessionHash, status: 'uploading', derivative_status: file.mediaType === 'video' ? 'not_required' : file.variants.length ? 'pending' : 'unavailable',
      upload_expires_at: authorizationExpiresAt, last_put_expires_at: lastPutExpiresAt, created_at: now.toISOString(),
    }
    rows.push(row)
    statements.push(env.DB.prepare(`INSERT INTO media (
      id, request_id, client_id, event_id, media_type, mime_type, staging_original_object_key, staging_display_object_key, staging_thumbnail_object_key, original_object_key, display_object_key, thumbnail_object_key,
      original_filename, guest_name, guest_message, size_bytes, display_size_bytes, thumbnail_size_bytes, width, height, duration_seconds,
      fingerprint, intent_hash, session_hash, status, derivative_status, last_put_expires_at, upload_expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?)`)
      .bind(id, payload.requestId, file.clientId, event.id, file.mediaType, file.mimeType, stagingOriginalKey, stagingDisplayKey, stagingThumbnailKey, originalKey, displayKey, thumbnailKey,
        file.filename, payload.guestName?.trim() || null, payload.guestMessage?.trim() || null, file.size, display?.size || 0, thumbnail?.size || 0,
        display?.width || file.width || null, display?.height || file.height || null, file.durationSeconds || null, file.fingerprint, requestIntent, sessionHash,
        row.derivative_status, lastPutExpiresAt, authorizationExpiresAt, now.toISOString()))
  }
  statements.push(env.DB.prepare("UPDATE upload_requests SET status = 'prepared', expires_at = ? WHERE id = ? AND status = 'preparing'").bind(authorizationExpiresAt, payload.requestId))
  await env.DB.batch(statements)
  requestClaimPreparing = false
  return json(request, env, { uploads: await Promise.all(rows.map((row) => signRow(env, row, ttl))) }, 201)
  } catch (error) {
    if (requestClaimPreparing) await releaseUploadRequestClaim(env, payload.requestId, sessionHash, requestIntent).catch(() => undefined)
    throw error
  }
}

async function getOwnedUpload(request: Request, env: Env, mediaId: string) {
  if (!validUuid(mediaId)) throw new HttpError(404, 'UPLOAD_NOT_FOUND', 'This upload could not be found.')
  const sessionHash = await secureValueHash(env, guestSession(request))
  const row = await env.DB.prepare(`SELECT m.*, e.event_date, e.slug AS event_slug FROM media m JOIN events e ON e.id = m.event_id WHERE m.id = ?`).bind(mediaId).first<UploadRow>()
  if (!row || row.session_hash !== sessionHash) throw new HttpError(404, 'UPLOAD_NOT_FOUND', 'This upload could not be found.')
  return row
}

export async function completeUploadRoute(request: Request, env: Env, mediaId: string) {
  requireOrigin(request, env)
  const payload = await parseJson<CompleteUploadRequest>(request)
  let row = await getOwnedUpload(request, env, mediaId)
  if (row.status === 'pending' || row.status === 'approved') return json(request, env, { mediaId: row.id, status: row.status })
  if (!['uploading', 'reconciling'].includes(row.status)) throw new HttpError(409, 'INVALID_UPLOAD_STATE', 'This upload can no longer be completed.')
  if (!Array.isArray(payload.uploadedVariants) || payload.uploadedVariants.some((variant) => !['display','thumbnail'].includes(variant))) throw new HttpError(400, 'INVALID_COMPLETION', 'The upload result could not be read.')
  await rateLimit(env, `complete:${row.session_hash}`, 'complete', 100, 600)

  if (row.status === 'uploading') {
    const claim = await env.DB.prepare("UPDATE media SET status = 'reconciling' WHERE id = ? AND status = 'uploading'").bind(row.id).run()
    if (!claim.meta.changes) row = await getOwnedUpload(request, env, mediaId)
    else row = { ...row, status: 'reconciling' }
  }

  try {
    const result = await finalizeUpload(env, row)
    if (!result.completed) {
      const retryable = Date.parse(row.upload_expires_at) > Date.now()
      if (retryable) await env.DB.prepare("UPDATE media SET status = 'uploading' WHERE id = ? AND status = 'reconciling'").bind(row.id).run()
      throw new HttpError(409, 'ORIGINAL_MISSING', 'The original file has not finished uploading yet.', retryable)
    }
    return json(request, env, { mediaId: row.id, status: result.status })
  } catch (error) {
    if (!(error instanceof HttpError) && Date.parse(row.upload_expires_at) > Date.now()) await env.DB.prepare("UPDATE media SET status = 'uploading' WHERE id = ? AND status = 'reconciling'").bind(row.id).run()
    throw error
  }
}

async function discardInvalidRetryObjects(env: Env, row: UploadRow) {
  const expected = [
    [row.staging_original_object_key, row.size_bytes, row.mime_type],
    [row.staging_display_object_key, row.display_size_bytes, 'image/webp'],
    [row.staging_thumbnail_object_key, row.thumbnail_size_bytes, 'image/webp'],
  ] as const
  await Promise.all(expected.map(async ([key, size, mime]) => {
    if (!key || !await env.MEDIA.head(key)) return
    if (!await verifiedObject(env, key, size, mime)) await env.MEDIA.delete(key)
  }))
}

export async function refreshUploadRoute(request: Request, env: Env, mediaId: string) {
  requireOrigin(request, env)
  await parseJson<Record<string, never>>(request)
  const row = await getOwnedUpload(request, env, mediaId)
  if (row.status !== 'uploading') throw new HttpError(409, 'INVALID_UPLOAD_STATE', 'This upload no longer accepts new file data.')
  let authorizationRemaining = Math.floor((Date.parse(row.upload_expires_at) - Date.now()) / 1000)
  if (!Number.isFinite(authorizationRemaining) || authorizationRemaining < 15) throw new HttpError(409, 'UPLOAD_AUTHORIZATION_EXPIRED', 'This check-in has expired. Please begin again.')
  await rateLimit(env, `refresh:${row.session_hash}`, 'refresh', 40, 600)
  await discardInvalidRetryObjects(env, row)
  const current = await getOwnedUpload(request, env, mediaId)
  if (current.status !== 'uploading') throw new HttpError(409, 'INVALID_UPLOAD_STATE', 'This upload no longer accepts new file data.')
  authorizationRemaining = Math.floor((Date.parse(row.upload_expires_at) - Date.now()) / 1000)
  if (!Number.isFinite(authorizationRemaining) || authorizationRemaining < 15) throw new HttpError(409, 'UPLOAD_AUTHORIZATION_EXPIRED', 'This check-in has expired. Please begin again.')
  const ttl = Math.max(1, Math.min(configuredPutTtl(env), authorizationRemaining))
  const lastPutExpiresAt = new Date(Math.min(Date.now() + ttl * 1000, Date.parse(row.upload_expires_at))).toISOString()
  await env.DB.prepare("UPDATE media SET last_put_expires_at = ?, staging_purged_at = NULL WHERE id = ? AND status = 'uploading'").bind(lastPutExpiresAt, row.id).run()
  const response: UploadRefreshResponse = {
    original: await signedPut(env, row.staging_original_object_key, row.mime_type, ttl, row.upload_expires_at),
    display: row.staging_display_object_key ? await signedPut(env, row.staging_display_object_key, 'image/webp', ttl, row.upload_expires_at) : undefined,
    thumbnail: row.staging_thumbnail_object_key ? await signedPut(env, row.staging_thumbnail_object_key, 'image/webp', ttl, row.upload_expires_at) : undefined,
  }
  return json(request, env, response)
}
