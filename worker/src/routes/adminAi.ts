import type { AdminAiStats, AiJob, FaceCalibration, FaceCalibrationComparison } from '../../../shared/contracts'
import type { Env } from '../env'
import { getFaceProvider } from '../ai/faces/providerFactory'
import { enqueueAiJob, faceToggleAiOutboxStatements, reprocessAiOutboxStatements } from '../ai/jobs'
import { HttpError, json, parseJson, requireOrigin } from '../lib/http'
import { requireAdmin } from '../security/adminSession'

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function actor(sessionHash: string) {
  return `session:${sessionHash.slice(0, 12)}`
}

export async function adminAiStatsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  const [row, paused, faceSetting] = await Promise.all([
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM media WHERE status='approved' AND deleted_at IS NULL) AS total_eligible,
      (SELECT COUNT(*) FROM media_ai WHERE overall_status='complete') AS indexed,
      (SELECT COUNT(*) FROM ai_jobs WHERE status IN ('queued','dispatched')) AS queued,
      (SELECT COUNT(*) FROM ai_jobs WHERE status='processing') AS processing,
      (SELECT COUNT(*) FROM ai_jobs WHERE status='failed') AS failed,
      (SELECT COUNT(*) FROM media_ai WHERE categorisation_status='complete') AS categorised,
      (SELECT COUNT(*) FROM media_ai WHERE face_index_status='complete') AS face_indexed_photos,
      (SELECT COUNT(*) FROM detected_faces WHERE deleted_at IS NULL) AS detected_faces,
      (SELECT COUNT(*) FROM media_ai WHERE semantic_index_status='complete') AS semantic_indexed`).first<Record<string, number>>(),
    env.DB.prepare("SELECT value FROM settings WHERE key='ai_processing_paused'").first<{ value: string }>(),
    env.DB.prepare("SELECT value FROM settings WHERE key='face_search_enabled'").first<{ value: string }>(),
  ])
  const number = (key: string) => Number(row?.[key] || 0)
  const data: AdminAiStats = {
    totalEligible: number('total_eligible'),
    indexed: number('indexed'),
    queued: number('queued'),
    processing: number('processing'),
    failed: number('failed'),
    notProcessed: Math.max(0, number('total_eligible') - number('indexed')),
    categorised: number('categorised'),
    faceIndexedPhotos: number('face_indexed_photos'),
    detectedFaces: number('detected_faces'),
    semanticIndexed: number('semantic_indexed'),
    paused: paused?.value === 'true',
    faceSearchAvailable: faceSetting?.value === 'true' && Boolean(getFaceProvider(env) && env.FACE_INDEX),
  }
  return json(request, env, data, 200, { 'Cache-Control': 'no-store' })
}

type AiJobApiRow = {
  id: string
  job_type: AiJob['type']
  media_id: string | null
  status: AiJob['status']
  attempt_count: number
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
}

export async function adminAiJobsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  if (status && !['queued','dispatched','processing','complete','partial','failed','dismissed','cancelled'].includes(status)) {
    throw new HttpError(400, 'INVALID_JOB_STATUS', 'Unknown AI job status.')
  }
  const result = status
    ? await env.DB.prepare(`SELECT id,job_type,media_id,status,attempt_count,last_error_code,last_error_message,created_at,updated_at
      FROM ai_jobs WHERE status=? ORDER BY created_at DESC LIMIT 100`).bind(status).all<AiJobApiRow>()
    : await env.DB.prepare(`SELECT id,job_type,media_id,status,attempt_count,last_error_code,last_error_message,created_at,updated_at
      FROM ai_jobs ORDER BY created_at DESC LIMIT 100`).all<AiJobApiRow>()
  const jobs: AiJob[] = result.results.map((row) => ({
    id: row.id, type: row.job_type, mediaId: row.media_id, status: row.status, attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code, lastErrorMessage: row.last_error_message, createdAt: row.created_at, updatedAt: row.updated_at,
  }))
  return json(request, env, { jobs }, 200, { 'Cache-Control': 'no-store' })
}

export async function adminAiBackfillRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  const payload = await parseJson<{ mode?: 'unprocessed' | 'failed' | 'all' | 'selected'; mediaIds?: string[]; limit?: number }>(request)
  const mode = payload.mode || 'unprocessed'
  if (!['unprocessed','failed','all','selected'].includes(mode)) throw new HttpError(400, 'INVALID_BACKFILL_MODE', 'Unknown backfill mode.')
  let ids: string[]
  const limit = Math.min(500, Math.max(1, Number(payload.limit || 200)))
  if (mode === 'selected') {
    if (!Array.isArray(payload.mediaIds) || !payload.mediaIds.length || payload.mediaIds.length > 100 || payload.mediaIds.some((id) => !validUuid(id))) {
      throw new HttpError(400, 'INVALID_MEDIA_IDS', 'Choose up to 100 valid memories.')
    }
    ids = [...new Set(payload.mediaIds)]
  } else {
    const condition = mode === 'unprocessed'
      ? "(ma.media_id IS NULL OR ma.overall_status IN ('not_requested','disabled'))"
      : mode === 'failed'
        ? "ma.overall_status IN ('failed','partial')"
        : '1=1'
    const result = await env.DB.prepare(`SELECT m.id FROM media m LEFT JOIN media_ai ma ON ma.media_id=m.id
      WHERE m.status='approved' AND m.deleted_at IS NULL AND ${condition} ORDER BY m.created_at,m.id LIMIT ?`)
      .bind(limit + 1).all<{ id: string }>()
    ids = result.results.slice(0, limit).map((row) => row.id)
  }
  const now = new Date().toISOString()
  const runId = crypto.randomUUID()
  for (let offset = 0; offset < ids.length; offset += 40) {
    await env.DB.batch(reprocessAiOutboxStatements(env, ids.slice(offset, offset + 40), actor(admin.sessionHash), now, runId))
  }
  await env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), actor(admin.sessionHash), 'ai_backfill', null, JSON.stringify({ mode, queued: ids.length, runId }), now).run()
  return json(request, env, { queued: ids.length, runId, truncated: mode !== 'selected' && ids.length === limit }, 202, { 'Cache-Control': 'no-store' })
}

export async function adminAiJobActionRoute(request: Request, env: Env, jobId: string, action: 'retry' | 'dismiss') {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  await parseJson<Record<string, never>>(request)
  const now = new Date().toISOString()
  const result = action === 'retry'
    ? await env.DB.prepare(`UPDATE ai_jobs SET status='queued',dispatch_token=NULL,dispatched_at=NULL,available_at=?,last_error_code=NULL,last_error_message=NULL,
      attempt_count=0,workflow_id=NULL,started_at=NULL,completed_at=NULL,updated_at=? WHERE id=? AND status IN ('failed','partial','dismissed')`).bind(now, now, jobId).run()
    : await env.DB.prepare("UPDATE ai_jobs SET status='dismissed',updated_at=? WHERE id=? AND status='failed'").bind(now, jobId).run()
  if (!result.meta.changes) throw new HttpError(409, 'JOB_STATE_CONFLICT', 'This AI job is no longer eligible for that action.')
  await env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,NULL,?)')
    .bind(crypto.randomUUID(), actor(admin.sessionHash), `ai_job_${action}`, jobId, now).run()
  return json(request, env, { updated: true }, 200, { 'Cache-Control': 'no-store' })
}

export async function adminFaceToggleRoute(request: Request, env: Env, mediaId: string) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  if (!validUuid(mediaId)) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  const payload = await parseJson<{ enabled?: boolean }>(request)
  if (typeof payload.enabled !== 'boolean') throw new HttpError(400, 'INVALID_FACE_SETTING', 'Choose whether this memory may appear in Find Me.')
  const current = await env.DB.prepare("SELECT status,face_search_enabled,face_search_revision FROM media WHERE id=? AND status NOT IN ('deleted','expired')")
    .bind(mediaId).first<{ status:string;face_search_enabled:number;face_search_revision:number }>()
  if (!current) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  if (current.status !== 'approved') throw new HttpError(409, 'MEDIA_NOT_APPROVED', 'Only approved memories can change Find Me indexing.')
  if (Boolean(current.face_search_enabled) === payload.enabled) {
    return json(request, env, { faceSearchEnabled: payload.enabled }, 200, { 'Cache-Control': 'no-store' })
  }
  const now = new Date().toISOString()
  const targetRevision = current.face_search_revision + 1
  const [result] = await env.DB.batch([
    env.DB.prepare(`UPDATE media SET face_search_enabled=?,face_search_revision=face_search_revision+1
      WHERE id=? AND status='approved' AND face_search_enabled<>? AND face_search_revision=?`)
      .bind(payload.enabled ? 1 : 0, mediaId, payload.enabled ? 1 : 0, current.face_search_revision),
    ...faceToggleAiOutboxStatements(env, mediaId, payload.enabled, targetRevision, actor(admin.sessionHash), now),
  ])
  if (!result.meta.changes) {
    const media = await env.DB.prepare("SELECT status,face_search_enabled FROM media WHERE id=? AND status NOT IN ('deleted','expired')")
      .bind(mediaId).first<{ status:string;face_search_enabled:number }>()
    if (!media) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
    if (media.status !== 'approved') throw new HttpError(409, 'MEDIA_NOT_APPROVED', 'Only approved memories can change Find Me indexing.')
    if (Boolean(media.face_search_enabled) !== payload.enabled) throw new HttpError(409, 'FACE_SETTING_CONFLICT', 'This memory changed while the setting was saved.', true)
  }
  await env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), actor(admin.sessionHash), 'face_search_media_update', mediaId, JSON.stringify({ enabled: payload.enabled }), now).run()
  return json(request, env, { faceSearchEnabled: payload.enabled }, 200, { 'Cache-Control': 'no-store' })
}

export async function adminCategoryOverrideRoute(request: Request, env: Env, mediaId: string) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  if (!validUuid(mediaId)) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  const payload = await parseJson<{ action?: 'add' | 'remove' | 'suppress' | 'restore'; categorySlug?: string }>(request)
  if (!payload.action || !['add','remove','suppress','restore'].includes(payload.action) || !payload.categorySlug || !/^[a-z0-9-]{1,64}$/.test(payload.categorySlug)) {
    throw new HttpError(400, 'INVALID_CATEGORY_ACTION', 'Choose a valid category action.')
  }
  const category = await env.DB.prepare('SELECT id FROM categories WHERE slug=? AND enabled=1').bind(payload.categorySlug).first<{ id: string }>()
  if (!category) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'This category is unavailable.')
  const now = new Date().toISOString()
  if (payload.action === 'add') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM media_category_suppressions WHERE media_id=? AND category_id=?').bind(mediaId, category.id),
      env.DB.prepare(`INSERT INTO media_categories(media_id,category_id,confidence,source,analysis_schema_version,created_at,updated_at)
        VALUES(?,?,NULL,'admin',NULL,?,?) ON CONFLICT(media_id,category_id,source) DO UPDATE SET updated_at=excluded.updated_at`)
        .bind(mediaId, category.id, now, now),
    ])
  } else if (payload.action === 'remove') {
    await env.DB.prepare("DELETE FROM media_categories WHERE media_id=? AND category_id=? AND source='admin'").bind(mediaId, category.id).run()
  } else if (payload.action === 'suppress') {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM media_categories WHERE media_id=? AND category_id=? AND source='ai'").bind(mediaId, category.id),
      env.DB.prepare('INSERT INTO media_category_suppressions(media_id,category_id,created_at) VALUES(?,?,?) ON CONFLICT(media_id,category_id) DO NOTHING').bind(mediaId, category.id, now),
    ])
  } else {
    await env.DB.prepare('DELETE FROM media_category_suppressions WHERE media_id=? AND category_id=?').bind(mediaId, category.id).run()
  }
  await env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), actor(admin.sessionHash), `category_${payload.action}`, mediaId, JSON.stringify({ categorySlug: payload.categorySlug }), now).run()
  return json(request, env, { updated: true }, 200, { 'Cache-Control': 'no-store' })
}

type CalibrationApiRow = {
  id: string; provider: string; model: string; model_version: string; dimensions: number
  distance_metric: FaceCalibration['metric']; match_threshold: number; strong_match_threshold: number
  notes: string | null; active: number; updated_at: string
}

function mapCalibration(row: CalibrationApiRow): FaceCalibration {
  return { id: row.id, provider: row.provider, model: row.model, modelVersion: row.model_version, dimensions: row.dimensions,
    metric: row.distance_metric, matchThreshold: row.match_threshold, strongMatchThreshold: row.strong_match_threshold,
    notes: row.notes, active: Boolean(row.active), updatedAt: row.updated_at }
}

export async function adminFaceCalibrationsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  const result = await env.DB.prepare(`SELECT id,provider,model,model_version,dimensions,distance_metric,match_threshold,
    strong_match_threshold,notes,active,updated_at FROM face_calibrations ORDER BY active DESC,updated_at DESC LIMIT 50`).all<CalibrationApiRow>()
  return json(request, env, { calibrations: result.results.map(mapCalibration) }, 200, { 'Cache-Control': 'no-store' })
}

async function readCalibrationForm(request: Request) {
  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw new HttpError(415,'MULTIPART_REQUIRED','Upload two image files for comparison.')
  const limit = 13 * 1024 ** 2
  const declared = Number(request.headers.get('Content-Length') || 0)
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413,'CALIBRATION_IMAGES_TOO_LARGE','Choose two images under 6 MB each.')
  if (!request.body) throw new HttpError(400,'CALIBRATION_IMAGES_REQUIRED','Choose two images to compare.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done,value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) { await reader.cancel().catch(() => undefined); throw new HttpError(413,'CALIBRATION_IMAGES_TOO_LARGE','Choose two images under 6 MB each.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk,offset);offset += chunk.byteLength }
  try { return await new Response(bytes,{ headers:{ 'Content-Type':contentType } }).formData() }
  finally { bytes.fill(0) }
}

export async function adminCompareFaceCalibrationRoute(request: Request, env: Env) {
  requireOrigin(request,env)
  await requireAdmin(request,env)
  const provider = getFaceProvider(env)
  if (!provider) throw new HttpError(503,'FACE_PROVIDER_UNAVAILABLE','Configure a face embedding provider before comparing calibration examples.')
  const form = await readCalibrationForm(request)
  const left = form.get('left')
  const right = form.get('right')
  const isImage = (value: FormDataEntryValue | null): value is File => value instanceof File && value.size > 0 && value.size <= 6 * 1024 ** 2 && ['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(value.type.toLowerCase())
  if (!isImage(left) || !isImage(right)) throw new HttpError(400,'CALIBRATION_IMAGES_INVALID','Choose two JPEG, PNG, WebP, HEIC, or HEIF images under 6 MB each.')
  const leftBytes = new Uint8Array(await left.arrayBuffer())
  const rightBytes = new Uint8Array(await right.arrayBuffer())
  let leftVector: number[] | null = null
  let rightVector: number[] | null = null
  try {
    const [leftFaces,rightFaces] = await Promise.all([provider.analyseImage(leftBytes.buffer,left.type),provider.analyseImage(rightBytes.buffer,right.type)])
    if (leftFaces.length !== 1 || rightFaces.length !== 1) throw new HttpError(422,'CALIBRATION_ONE_FACE_REQUIRED','Each comparison image must contain exactly one clear face.')
    leftVector = leftFaces[0].embedding
    rightVector = rightFaces[0].embedding
    if (leftVector.length !== provider.dimensions || rightVector.length !== provider.dimensions) throw new HttpError(502,'FACE_DIMENSION_MISMATCH','The provider returned an unexpected embedding size.')
    let dot = 0
    let leftNorm = 0
    let rightNorm = 0
    let distanceSquared = 0
    for (let index=0;index<leftVector.length;index+=1) {
      const a=leftVector[index]
      const b=rightVector[index]
      dot += a*b
      leftNorm += a*a
      rightNorm += b*b
      distanceSquared += (a-b)**2
    }
    const cosine = leftNorm > 0 && rightNorm > 0 ? dot / Math.sqrt(leftNorm*rightNorm) : 0
    const result: FaceCalibrationComparison = { provider:provider.provider,model:provider.model,modelVersion:provider.modelVersion,dimensions:provider.dimensions,metric:provider.metric,
      cosineSimilarity:cosine,dotProduct:dot,euclideanDistance:Math.sqrt(distanceSquared),leftQuality:leftFaces[0].quality,rightQuality:rightFaces[0].quality }
    return json(request,env,result,200,{ 'Cache-Control':'no-store' })
  } finally {
    leftBytes.fill(0);rightBytes.fill(0);leftVector?.fill(0);rightVector?.fill(0);leftVector=null;rightVector=null
  }
}

export async function adminSaveFaceCalibrationRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  const provider = getFaceProvider(env)
  if (!provider || !env.FACE_INDEX) throw new HttpError(503, 'FACE_PROVIDER_UNAVAILABLE', 'Configure the face provider and matching Vectorize index first.')
  const payload = await parseJson<{ matchThreshold?: number; strongMatchThreshold?: number; notes?: string; confirmation?: string }>(request)
  const scoreMin = Number(env.FACE_SCORE_MIN)
  const scoreMax = Number(env.FACE_SCORE_MAX)
  if (!Number.isFinite(scoreMin) || !Number.isFinite(scoreMax) || scoreMin >= scoreMax) throw new HttpError(503, 'FACE_SCORE_BOUNDS_REQUIRED', 'Configure documented score bounds for this provider and model before calibration.')
  if (payload.confirmation !== 'USE THESE THRESHOLDS' || typeof payload.matchThreshold !== 'number' || typeof payload.strongMatchThreshold !== 'number' ||
    !Number.isFinite(payload.matchThreshold) || !Number.isFinite(payload.strongMatchThreshold) || payload.strongMatchThreshold < payload.matchThreshold ||
    payload.matchThreshold < scoreMin || payload.strongMatchThreshold > scoreMax ||
    (payload.notes?.length || 0) > 500) throw new HttpError(400, 'INVALID_CALIBRATION', 'Review the thresholds and type the required confirmation.')
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('UPDATE face_calibrations SET active=0,updated_at=? WHERE active=1').bind(now),
    env.DB.prepare(`INSERT INTO face_calibrations(id,provider,model,model_version,dimensions,distance_metric,match_threshold,
      strong_match_threshold,notes,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)`)
      .bind(id, provider.provider, provider.model, provider.modelVersion, provider.dimensions, provider.metric,
        payload.matchThreshold, payload.strongMatchThreshold, payload.notes?.trim() || null, now, now),
    env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), actor(admin.sessionHash), 'face_calibration_activate', id,
        JSON.stringify({ provider: provider.provider, modelVersion: provider.modelVersion, dimensions: provider.dimensions, metric: provider.metric }), now),
  ])
  return json(request, env, { calibration: mapCalibration({ id,provider:provider.provider,model:provider.model,model_version:provider.modelVersion,
    dimensions:provider.dimensions,distance_metric:provider.metric,match_threshold:payload.matchThreshold,strong_match_threshold:payload.strongMatchThreshold,
    notes:payload.notes?.trim() || null,active:1,updated_at:now }) }, 201, { 'Cache-Control': 'no-store' })
}

export async function adminPurgeFacesRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  const payload = await parseJson<{ confirmation?: string }>(request)
  if (payload.confirmation !== 'PURGE FACE INDEX') throw new HttpError(400, 'PURGE_CONFIRMATION_REQUIRED', 'Type PURGE FACE INDEX to continue.')
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key='face_search_enabled'").first<{ value: string }>()
  if (setting?.value === 'true') throw new HttpError(409, 'DISABLE_FIND_ME_FIRST', 'Disable Find Me before purging the face index.')
  const jobId = await enqueueAiJob(env, 'PURGE_ALL_FACES', null, actor(admin.sessionHash), { uniqueSuffix: crypto.randomUUID(), priority: 1 })
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,NULL,?)')
    .bind(crypto.randomUUID(), actor(admin.sessionHash), 'face_index_purge_requested', jobId, now).run()
  return json(request, env, { jobId }, 202, { 'Cache-Control': 'no-store' })
}
