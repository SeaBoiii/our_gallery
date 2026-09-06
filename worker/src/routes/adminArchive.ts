import type { ArchiveArtifact, ArchiveJob, ArchivePart, EventSlug } from '../../../shared/contracts'
import type { Env } from '../env'
import { HttpError, json, parseJson, requireOrigin } from '../lib/http'
import { signedDownload } from '../r2/signing'
import { requireAdmin } from '../security/adminSession'
import { base64url, fromBase64url, textEncoder, verifySecret } from '../security/hash'
import { readOperationalSettings } from '../settings'

const MIN_SHARD_BYTES = 2 * 1024 ** 3
const MAX_SHARD_BYTES = 10 * 1024 ** 3
const DEFAULT_SHARD_BYTES = 5 * 1024 ** 3
const ARCHIVE_API_BATCH = 15

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function actor(sessionHash: string) { return `session:${sessionHash.slice(0, 12)}` }

function unsafeArchiveCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ||
      code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
  })
}

function safeArchivePath(value: string, maximumBytes = 500) {
  if (!value || value.startsWith('/') || value.startsWith('\\') || value.includes('\\') || textEncoder.encode(value).byteLength > maximumBytes) return false
  const segments = value.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && textEncoder.encode(segment).byteLength <= 255 &&
    !unsafeArchiveCharacter(segment))
}

type ArchiveJobRow = {
  id: string; status: ArchiveJob['status']; scope: ArchiveJob['scope']; event_id: string | null; shard_size_bytes: number
  total_files: number; total_bytes: number; processed_files: number; processed_bytes: number; error_message: string | null
  created_at: string; started_at: string | null; completed_at: string | null; lease_generation: number
}

type ArchivePartRow = {
  id: string; event_id: string; event_display_name: string; part_number: number; filename: string; size_bytes: number
  sha256: string; file_count: number; status: ArchivePart['status']; plan_sha256: string | null
}

type ArchiveArtifactRow = {
  id: string; kind: ArchiveArtifact['kind']; filename: string; size_bytes: number; sha256: string
}

async function mapArchiveJob(env: Env, row: ArchiveJobRow): Promise<ArchiveJob> {
  const [parts, artifacts] = await Promise.all([
    env.DB.prepare(`SELECT ap.id,ap.event_id,e.display_name AS event_display_name,ap.part_number,ap.filename,ap.size_bytes,
      ap.sha256,ap.file_count,ap.status,ap.plan_sha256 FROM archive_parts ap JOIN events e ON e.id=ap.event_id
      WHERE ap.archive_job_id=? ORDER BY e.event_date,ap.part_number`).bind(row.id).all<ArchivePartRow>(),
    env.DB.prepare('SELECT id,kind,filename,size_bytes,sha256 FROM archive_artifacts WHERE archive_job_id=? ORDER BY kind')
      .bind(row.id).all<ArchiveArtifactRow>(),
  ])
  return {
    id: row.id, status: row.status, scope: row.scope, eventId: row.event_id, shardSizeBytes: row.shard_size_bytes,
    totalFiles: row.total_files, totalBytes: row.total_bytes, processedFiles: row.processed_files, processedBytes: row.processed_bytes,
    errorMessage: row.error_message, createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at,
    parts: parts.results.map((part) => ({ id:part.id,eventId:part.event_id,eventDisplayName:part.event_display_name,
      partNumber:part.part_number,filename:part.filename,sizeBytes:part.size_bytes,sha256:part.sha256,fileCount:part.file_count,status:part.status,planSha256:part.plan_sha256 })),
    artifacts: artifacts.results.map((artifact) => ({ id:artifact.id,kind:artifact.kind,filename:artifact.filename,sizeBytes:artifact.size_bytes,sha256:artifact.sha256 })),
  }
}

async function archiveJobRow(env: Env, id: string) {
  return env.DB.prepare(`SELECT id,status,scope,event_id,shard_size_bytes,total_files,total_bytes,processed_files,processed_bytes,
    error_message,created_at,started_at,completed_at,lease_generation FROM archive_jobs WHERE id=?`).bind(id).first<ArchiveJobRow>()
}

export async function adminCreateArchiveRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  const settings = await readOperationalSettings(env)
  if (settings.eventMode === 'live') throw new HttpError(409, 'ARCHIVE_MODE_REQUIRED', 'Switch to post-wedding or archive mode before creating a final archive.')
  const payload = await parseJson<{ scope?: 'all' | 'event'; eventSlug?: EventSlug; shardSizeBytes?: number }>(request)
  const scope = payload.scope || 'all'
  if (!['all','event'].includes(scope)) throw new HttpError(400, 'INVALID_ARCHIVE_SCOPE', 'Choose all events or one event.')
  if (scope === 'event' && !payload.eventSlug) throw new HttpError(400, 'ARCHIVE_EVENT_REQUIRED', 'Choose an event for this archive.')
  if (scope === 'all' && payload.eventSlug) throw new HttpError(400, 'ARCHIVE_EVENT_NOT_ALLOWED', 'Do not provide an event when archiving all celebrations.')
  const shardSize = Number(payload.shardSizeBytes || DEFAULT_SHARD_BYTES)
  if (!Number.isSafeInteger(shardSize) || shardSize < MIN_SHARD_BYTES || shardSize > MAX_SHARD_BYTES) {
    throw new HttpError(400, 'INVALID_SHARD_SIZE', 'Archive shards must be between 2 GB and 10 GB.')
  }
  const event = payload.eventSlug
    ? await env.DB.prepare('SELECT id FROM events WHERE slug=?').bind(payload.eventSlug).first<{ id: string }>()
    : null
  if (payload.eventSlug && !event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'The archive event could not be found.')
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const eventClause = scope === 'event' ? 'AND m.event_id=?' : ''
  const itemBindings: unknown[] = [id]
  if (scope === 'event') itemBindings.push(event!.id)
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO archive_jobs(id,status,scope,event_id,shard_size_bytes,total_files,total_bytes,processed_files,
      processed_bytes,created_at,updated_at) VALUES(?,'draft',?,?,?,0,0,0,0,?,?)`)
      .bind(id, scope, event?.id || null, shardSize, now, now),
    env.DB.prepare(`INSERT INTO archive_items(
      archive_job_id,media_id,event_id,event_slug,event_date,event_display_name,event_sequence,original_object_key,
      original_filename,mime_type,size_bytes,uploaded_at,guest_name,guest_message,categories_json,ai_caption
      ,media_type,width,height,duration_seconds,source,moderation_status
    ) SELECT ?,m.id,e.id,e.slug,e.event_date,e.display_name,
      ROW_NUMBER() OVER(PARTITION BY e.id ORDER BY m.created_at,m.id),m.original_object_key,m.original_filename,m.mime_type,
      m.size_bytes,m.created_at,m.guest_name,m.guest_message,
      COALESCE((SELECT json_group_array(c.display_name) FROM media_categories mc JOIN categories c ON c.id=mc.category_id
        WHERE mc.media_id=m.id AND c.enabled=1 AND (mc.source='admin' OR NOT EXISTS (
          SELECT 1 FROM media_category_suppressions s WHERE s.media_id=m.id AND s.category_id=mc.category_id
        ))),'[]'),ma.caption,m.media_type,m.width,m.height,m.duration_seconds,m.source,m.status
      FROM media m JOIN events e ON e.id=m.event_id LEFT JOIN media_ai ma ON ma.media_id=m.id
      WHERE m.status IN ('pending','approved','rejected') AND m.deleted_at IS NULL ${eventClause}
      ORDER BY e.event_date,m.created_at,m.id`).bind(...itemBindings),
    env.DB.prepare(`UPDATE archive_jobs SET status='inventory',total_files=(SELECT COUNT(*) FROM archive_items WHERE archive_job_id=?),
      total_bytes=(SELECT COALESCE(SUM(size_bytes),0) FROM archive_items WHERE archive_job_id=?),updated_at=? WHERE id=?`)
      .bind(id, id, now, id),
    env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), actor(admin.sessionHash), 'archive_create', id, JSON.stringify({ scope, eventSlug: payload.eventSlug || null, shardSize }), now),
  ])
  const row = await archiveJobRow(env, id)
  return json(request, env, await mapArchiveJob(env, row!), 201, { 'Cache-Control': 'no-store' })
}

export async function adminArchivesRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  const result = await env.DB.prepare(`SELECT id,status,scope,event_id,shard_size_bytes,total_files,total_bytes,processed_files,
    processed_bytes,error_message,created_at,started_at,completed_at,lease_generation FROM archive_jobs ORDER BY created_at DESC LIMIT 20`).all<ArchiveJobRow>()
  return json(request, env, { jobs: await Promise.all(result.results.map((row) => mapArchiveJob(env, row))) }, 200, { 'Cache-Control': 'no-store' })
}

export async function adminArchiveDetailRoute(request: Request, env: Env, jobId: string) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  if (!validUuid(jobId)) throw new HttpError(404, 'ARCHIVE_NOT_FOUND', 'This archive job could not be found.')
  const row = await archiveJobRow(env, jobId)
  if (!row) throw new HttpError(404, 'ARCHIVE_NOT_FOUND', 'This archive job could not be found.')
  return json(request, env, await mapArchiveJob(env, row), 200, { 'Cache-Control': 'no-store' })
}

export async function adminCancelArchiveRoute(request: Request, env: Env, jobId: string) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  const payload = await parseJson<{ confirmation?: string }>(request)
  if (payload.confirmation !== `CANCEL ${jobId}`) throw new HttpError(400, 'CANCEL_CONFIRMATION_REQUIRED', `Type CANCEL ${jobId} to continue.`)
  const now = new Date().toISOString()
  const result = await env.DB.prepare(`UPDATE archive_jobs SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=?
    WHERE id=? AND status IN ('draft','inventory','building','partial','failed')`).bind(now, jobId).run()
  if (!result.meta.changes) throw new HttpError(409, 'ARCHIVE_STATE_CONFLICT', 'This archive can no longer be cancelled.')
  await env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,NULL,?)')
    .bind(crypto.randomUUID(), actor(admin.sessionHash), 'archive_cancel', jobId, now).run()
  return json(request, env, { cancelled: true }, 200, { 'Cache-Control': 'no-store' })
}

export async function adminArchiveDownloadRoute(request: Request, env: Env, jobId: string) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  const payload = await parseJson<{ partId?: string; artifactKind?: ArchiveArtifact['kind'] }>(request)
  if (Boolean(payload.partId) === Boolean(payload.artifactKind)) throw new HttpError(400, 'INVALID_ARCHIVE_DOWNLOAD', 'Choose one archive part or manifest artifact.')
  let object: { object_key: string; filename: string } | null
  if (payload.partId) {
    object = await env.DB.prepare(`SELECT ap.object_key,ap.filename FROM archive_parts ap JOIN archive_jobs aj ON aj.id=ap.archive_job_id WHERE ap.id=? AND ap.archive_job_id=? AND ap.status='complete' AND aj.status='complete'`)
      .bind(payload.partId, jobId).first<{ object_key: string; filename: string }>()
  } else {
    object = await env.DB.prepare("SELECT aa.object_key,aa.filename FROM archive_artifacts aa JOIN archive_jobs aj ON aj.id=aa.archive_job_id WHERE aa.archive_job_id=? AND aa.kind=? AND aj.status='complete'")
      .bind(jobId, payload.artifactKind).first<{ object_key: string; filename: string }>()
  }
  if (!object) throw new HttpError(404, 'ARCHIVE_FILE_NOT_FOUND', 'This archive file is not available.')
  const configuredTtl = Number(env.ARCHIVE_DOWNLOAD_TTL_SECONDS)
  const ttl = Math.floor(Math.min(3600, Math.max(60, Number.isFinite(configuredTtl) ? configuredTtl : 600)))
  return json(request, env, { url: await signedDownload(env, object.object_key, object.filename, ttl), expiresInSeconds: ttl }, 200, { 'Cache-Control': 'no-store' })
}

async function requireArchiveBuilder(request: Request, env: Env) {
  const expected = env.ARCHIVE_BUILDER_TOKEN
  if (!expected || expected.length < 32) throw new HttpError(503, 'ARCHIVE_BUILDER_UNCONFIGURED', 'The archive builder credential is not configured.')
  const header = request.headers.get('Authorization') || ''
  const candidate = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!candidate || candidate.length > 512 || !await verifySecret(candidate, expected, env.ADMIN_SESSION_SECRET)) {
    throw new HttpError(401, 'ARCHIVE_BUILDER_REQUIRED', 'A valid archive-builder credential is required.')
  }
}

function encodeInventoryCursor(row: { event_date: string; event_sequence: number; media_id: string }) {
  return base64url(textEncoder.encode(JSON.stringify({ date: row.event_date, sequence: row.event_sequence, mediaId: row.media_id })))
}

function decodeInventoryCursor(value: string | null) {
  if (!value) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(value))) as { date: string; sequence: number; mediaId: string }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) || !Number.isInteger(parsed.sequence) || !validUuid(parsed.mediaId)) throw new Error()
    return parsed
  } catch { throw new HttpError(400, 'INVALID_INVENTORY_CURSOR', 'The archive inventory cursor is invalid.') }
}

export async function builderArchiveJobRoute(request: Request, env: Env, jobId: string) {
  await requireArchiveBuilder(request, env)
  const row = await archiveJobRow(env, jobId)
  if (!row) throw new HttpError(404, 'ARCHIVE_NOT_FOUND', 'This archive job could not be found.')
  return json(request, env, await mapArchiveJob(env, row), 200, { 'Cache-Control': 'no-store' })
}

export async function builderClaimArchiveRoute(request: Request, env: Env, jobId: string) {
  await requireArchiveBuilder(request, env)
  const payload = await parseJson<{ builderId?: string; shardSizeBytes?: number }>(request)
  if (!payload.builderId || !/^[a-zA-Z0-9._:-]{8,100}$/.test(payload.builderId)) throw new HttpError(400, 'INVALID_BUILDER_ID', 'Provide a stable archive builder ID.')
  if (payload.shardSizeBytes !== undefined && (!Number.isSafeInteger(payload.shardSizeBytes) || payload.shardSizeBytes < MIN_SHARD_BYTES || payload.shardSizeBytes > MAX_SHARD_BYTES)) {
    throw new HttpError(400, 'INVALID_SHARD_SIZE', 'Archive shards must be between 2 GB and 10 GB.')
  }
  if (payload.shardSizeBytes !== undefined) {
    const current = await env.DB.prepare(`SELECT aj.shard_size_bytes,(SELECT COUNT(*) FROM archive_parts ap WHERE ap.archive_job_id=aj.id) AS parts
      FROM archive_jobs aj WHERE aj.id=?`).bind(jobId).first<{ shard_size_bytes: number; parts: number }>()
    if (!current) throw new HttpError(404, 'ARCHIVE_NOT_FOUND', 'This archive job could not be found.')
    if (Number(current.parts) > 0 && current.shard_size_bytes !== payload.shardSizeBytes) {
      throw new HttpError(409, 'ARCHIVE_SHARD_SIZE_LOCKED', 'The shard size cannot change after a part has completed.')
    }
    if (Number(current.parts) === 0 && current.shard_size_bytes !== payload.shardSizeBytes) {
      await env.DB.prepare('UPDATE archive_jobs SET shard_size_bytes=?,updated_at=? WHERE id=?').bind(payload.shardSizeBytes,new Date().toISOString(),jobId).run()
    }
  }
  const now = new Date()
  const nowIso = now.toISOString()
  const leaseExpires = new Date(now.getTime() + 10 * 60_000).toISOString()
  const result = await env.DB.prepare(`UPDATE archive_jobs SET status='building',lease_owner=?,lease_expires_at=?,lease_generation=lease_generation+1,
    started_at=COALESCE(started_at,?),error_code=NULL,error_message=NULL,updated_at=? WHERE id=?
    AND status IN ('inventory','building','partial','failed')
    AND (lease_owner IS NULL OR lease_owner=? OR lease_expires_at < ?)`)
    .bind(payload.builderId, leaseExpires, nowIso, nowIso, jobId, payload.builderId, nowIso).run()
  if (!result.meta.changes) throw new HttpError(409, 'ARCHIVE_LEASE_UNAVAILABLE', 'Another builder holds this archive job, or the job is no longer buildable.', true)
  const claimed = await env.DB.prepare('SELECT lease_generation FROM archive_jobs WHERE id=? AND lease_owner=?').bind(jobId,payload.builderId).first<{ lease_generation:number }>()
  return json(request, env, { claimed: true, leaseExpiresAt: leaseExpires, leaseGeneration:Number(claimed!.lease_generation) }, 200, { 'Cache-Control': 'no-store' })
}

type InventoryRow = {
  media_id: string; event_id: string; event_slug: string; event_date: string; event_display_name: string; event_sequence: number
  original_object_key: string; original_filename: string; archive_filename: string | null; mime_type: string; size_bytes: number
  sha256: string | null; uploaded_at: string; guest_name: string | null; guest_message: string | null; categories_json: string
  ai_caption: string | null; assigned_part: number | null; processed_at: string | null
  media_type: 'photo'|'video'; width:number|null; height:number|null; duration_seconds:number|null; source:'guest'|'photographer'; moderation_status:'pending'|'approved'|'rejected'
}

export async function builderArchiveItemsRoute(request: Request, env: Env, jobId: string) {
  await requireArchiveBuilder(request, env)
  const url = new URL(request.url)
  const cursor = decodeInventoryCursor(url.searchParams.get('cursor'))
  const event = url.searchParams.get('event')
  if (event && !['solemnisation','reception'].includes(event)) throw new HttpError(400, 'INVALID_EVENT', 'Unknown archive event.')
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 250))
  const clauses = ["ai.archive_job_id=?", "m.status NOT IN ('deleting','deleted','expired')", 'm.deleted_at IS NULL']
  const bindings: unknown[] = [jobId]
  if (event) { clauses.push('ai.event_slug=?'); bindings.push(event) }
  if (cursor) {
    clauses.push('(ai.event_date > ? OR (ai.event_date=? AND ai.event_sequence > ?) OR (ai.event_date=? AND ai.event_sequence=? AND ai.media_id > ?))')
    bindings.push(cursor.date,cursor.date,cursor.sequence,cursor.date,cursor.sequence,cursor.mediaId)
  }
  const result = await env.DB.prepare(`SELECT ai.media_id,ai.event_id,ai.event_slug,ai.event_date,ai.event_display_name,
    ai.event_sequence,ai.original_object_key,ai.original_filename,ai.archive_filename,ai.mime_type,ai.size_bytes,ai.sha256,
    ai.uploaded_at,ai.guest_name,ai.guest_message,ai.categories_json,ai.ai_caption,ai.assigned_part,ai.processed_at,
    ai.media_type,ai.width,ai.height,ai.duration_seconds,ai.source,ai.moderation_status
    FROM archive_items ai JOIN media m ON m.id=ai.media_id WHERE ${clauses.join(' AND ')}
    ORDER BY ai.event_date,ai.event_sequence,ai.media_id LIMIT ?`).bind(...bindings,limit + 1).all<InventoryRow>()
  const rows = result.results.slice(0, limit)
  const items = rows.map((row) => ({
    mediaId:row.media_id,eventId:row.event_id,eventSlug:row.event_slug,eventDate:row.event_date,eventDisplayName:row.event_display_name,
    eventSequence:row.event_sequence,originalObjectKey:row.original_object_key,originalFilename:row.original_filename,
    archiveFilename:row.archive_filename,mimeType:row.mime_type,sizeBytes:row.size_bytes,sha256:row.sha256,uploadedAt:row.uploaded_at,
    guestName:row.guest_name,guestMessage:row.guest_message,categories:JSON.parse(row.categories_json || '[]') as unknown,
    aiCaption:row.ai_caption,assignedPart:row.assigned_part,processedAt:row.processed_at,mediaType:row.media_type,width:row.width,
    height:row.height,durationSeconds:row.duration_seconds,source:row.source,moderationStatus:row.moderation_status,
  }))
  return json(request, env, { items, nextCursor: result.results.length > limit && rows.length ? encodeInventoryCursor(rows[rows.length - 1]) : null }, 200, { 'Cache-Control': 'no-store' })
}

export async function builderArchivePlanRoute(request: Request, env: Env, jobId: string) {
  await requireArchiveBuilder(request, env)
  const payload = await parseJson<{ builderId?:string;leaseGeneration?:number;eventId?:string;partNumber?:number;planSha256?:string;fileCount?:number;finalize?:boolean;items?:Array<{ mediaId:string;archiveFilename:string }> }>(request)
  if (!payload.builderId || !payload.eventId || !Number.isInteger(payload.partNumber) || payload.partNumber! < 1 || !/^[a-f0-9]{64}$/i.test(payload.planSha256 || '') ||
    !Number.isInteger(payload.fileCount) || payload.fileCount! < 1 || !Array.isArray(payload.items) || payload.items.length > ARCHIVE_API_BATCH || payload.items.some((item) => !validUuid(item.mediaId) || !safeArchivePath(item.archiveFilename))) {
    throw new HttpError(400, 'INVALID_ARCHIVE_PLAN', 'The deterministic archive plan batch is invalid.')
  }
  await requireBuilderLease(env,jobId,payload.builderId,payload.leaseGeneration)
  const planHash = payload.planSha256!.toLowerCase()
  const existingPlan = await env.DB.prepare('SELECT plan_sha256,file_count,status FROM archive_plans WHERE archive_job_id=? AND event_id=? AND part_number=?')
    .bind(jobId,payload.eventId,payload.partNumber).first<{ plan_sha256:string;file_count:number;status:string }>()
  if (existingPlan && (existingPlan.plan_sha256 !== planHash || existingPlan.file_count !== payload.fileCount)) throw new HttpError(409,'ARCHIVE_PLAN_CONFLICT','This shard number already has a different deterministic plan.')
  const now = new Date().toISOString()
  if (!existingPlan) {
    const inserted = await env.DB.prepare(`INSERT INTO archive_plans(archive_job_id,event_id,part_number,plan_sha256,file_count,status,created_at,updated_at)
      SELECT ?,?,?,?,?, 'planning',?,? WHERE EXISTS (SELECT 1 FROM archive_items WHERE archive_job_id=? AND event_id=?) AND EXISTS (
        SELECT 1 FROM archive_jobs WHERE id=? AND lease_owner=? AND lease_generation=? AND lease_expires_at>=?)`)
      .bind(jobId,payload.eventId,payload.partNumber,planHash,payload.fileCount,now,now,jobId,payload.eventId,jobId,payload.builderId,payload.leaseGeneration,now).run()
    if (!inserted.meta.changes) throw new HttpError(409,'ARCHIVE_LEASE_EXPIRED','The archive lease expired while persisting its plan.',true)
  }
  for (const item of payload.items) {
    const prior = await env.DB.prepare('SELECT event_id,part_number,archive_filename FROM archive_plan_items WHERE archive_job_id=? AND media_id=?')
      .bind(jobId,item.mediaId).first<{ event_id:string;part_number:number;archive_filename:string }>()
    if (prior && (prior.event_id !== payload.eventId || prior.part_number !== payload.partNumber || prior.archive_filename !== item.archiveFilename)) {
      throw new HttpError(409,'ARCHIVE_ITEM_PLAN_CONFLICT','An inventory item is already assigned to a different shard plan.')
    }
    if (!prior) {
      const inserted = await env.DB.prepare(`INSERT INTO archive_plan_items(archive_job_id,event_id,part_number,media_id,archive_filename,created_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM archive_items WHERE archive_job_id=? AND media_id=? AND event_id=?) AND EXISTS (
          SELECT 1 FROM archive_jobs WHERE id=? AND lease_owner=? AND lease_generation=? AND lease_expires_at>=?)`)
        .bind(jobId,payload.eventId,payload.partNumber,item.mediaId,item.archiveFilename,now,jobId,item.mediaId,payload.eventId,jobId,payload.builderId,payload.leaseGeneration,now).run()
      if (!inserted.meta.changes) throw new HttpError(409,'ARCHIVE_PLAN_ITEM_REJECTED','An archive plan item is outside the inventory or the lease expired.',true)
    }
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM archive_plan_items WHERE archive_job_id=? AND event_id=? AND part_number=?')
    .bind(jobId,payload.eventId,payload.partNumber).first<{ count:number }>()
  if (payload.finalize) {
    if (Number(count?.count || 0) !== payload.fileCount) throw new HttpError(409,'ARCHIVE_PLAN_INCOMPLETE','Persist every item in this shard before finalizing its plan.')
    const finalized = await env.DB.prepare(`UPDATE archive_plans SET status='planned',updated_at=? WHERE archive_job_id=? AND event_id=? AND part_number=? AND plan_sha256=? AND EXISTS (
      SELECT 1 FROM archive_jobs WHERE id=? AND lease_owner=? AND lease_generation=? AND lease_expires_at>=?)`)
      .bind(now,jobId,payload.eventId,payload.partNumber,planHash,jobId,payload.builderId,payload.leaseGeneration,now).run()
    if (!finalized.meta.changes) throw new HttpError(409,'ARCHIVE_LEASE_EXPIRED','The archive lease expired while finalizing its plan.',true)
  }
  return json(request,env,{ persisted:Number(count?.count || 0),planned:Boolean(payload.finalize) },200,{ 'Cache-Control':'no-store' })
}

async function requireBuilderLease(env: Env, jobId: string, builderId: string, leaseGeneration: number | undefined) {
  if (!Number.isInteger(leaseGeneration) || leaseGeneration! < 1) throw new HttpError(400, 'LEASE_GENERATION_REQUIRED', 'Provide the lease fencing generation returned by claim.')
  const row = await env.DB.prepare("SELECT id FROM archive_jobs WHERE id=? AND lease_owner=? AND lease_generation=? AND lease_expires_at>=? AND status IN ('building','partial')")
    .bind(jobId,builderId,leaseGeneration,new Date().toISOString()).first<{ id: string }>()
  if (!row) throw new HttpError(409, 'ARCHIVE_LEASE_EXPIRED', 'Claim or renew the archive job before writing progress.', true)
}

export async function builderArchiveProgressRoute(request: Request, env: Env, jobId: string) {
  await requireArchiveBuilder(request, env)
  const payload = await parseJson<{ builderId?: string; leaseGeneration?: number; status?: 'building' | 'partial' | 'failed'; processedFiles?: number; processedBytes?: number; errorCode?: string; errorMessage?: string }>(request)
  if (!payload.builderId || !payload.status || !['building','partial','failed'].includes(payload.status) || !Number.isSafeInteger(payload.processedFiles) || !Number.isSafeInteger(payload.processedBytes) ||
    payload.processedFiles! < 0 || payload.processedBytes! < 0 || (payload.errorCode?.length || 0) > 80 || (payload.errorMessage?.length || 0) > 240) {
    throw new HttpError(400, 'INVALID_ARCHIVE_PROGRESS', 'The archive progress update is invalid.')
  }
  await requireBuilderLease(env, jobId, payload.builderId, payload.leaseGeneration)
  const totals = await env.DB.prepare('SELECT total_files,total_bytes,processed_files,processed_bytes FROM archive_jobs WHERE id=?').bind(jobId).first<{ total_files:number;total_bytes:number;processed_files:number;processed_bytes:number }>()
  if (!totals || payload.processedFiles! > totals.total_files || payload.processedBytes! > totals.total_bytes) throw new HttpError(400, 'ARCHIVE_PROGRESS_EXCEEDS_TOTAL', 'Archive progress cannot exceed the inventory totals.')
  const now = new Date()
  const leaseExpires = new Date(now.getTime() + 10 * 60_000).toISOString()
  const updated = await env.DB.prepare(`UPDATE archive_jobs SET status=?,processed_files=MAX(processed_files,?),processed_bytes=MAX(processed_bytes,?),error_code=?,error_message=?,
    lease_expires_at=?,updated_at=? WHERE id=? AND lease_owner=? AND lease_generation=? AND lease_expires_at>=?`)
    .bind(payload.status,payload.processedFiles,payload.processedBytes,payload.errorCode || null,payload.errorMessage || null,leaseExpires,now.toISOString(),jobId,payload.builderId,payload.leaseGeneration,now.toISOString()).run()
  if (!updated.meta.changes) throw new HttpError(409, 'ARCHIVE_LEASE_EXPIRED', 'The archive lease expired while writing progress.', true)
  return json(request, env, { updated: true, leaseExpiresAt: leaseExpires }, 200, { 'Cache-Control': 'no-store' })
}

export async function builderArchiveChecksumsRoute(request: Request, env: Env, jobId: string) {
  await requireArchiveBuilder(request, env)
  const payload = await parseJson<{ builderId?: string; leaseGeneration?: number; items?: Array<{ mediaId: string; sha256: string; archiveFilename: string; partNumber: number }> }>(request)
  if (!payload.builderId || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > ARCHIVE_API_BATCH || payload.items.some((item) =>
    !validUuid(item.mediaId) || !/^[a-f0-9]{64}$/i.test(item.sha256) || item.archiveFilename.length < 1 || item.archiveFilename.length > 400 ||
    !safeArchivePath(item.archiveFilename) || !Number.isInteger(item.partNumber) || item.partNumber < 1)) {
    throw new HttpError(400, 'INVALID_ARCHIVE_CHECKSUMS', 'The archive checksum batch is invalid.')
  }
  await requireBuilderLease(env, jobId, payload.builderId, payload.leaseGeneration)
  const now = new Date().toISOString()
  const statements: D1PreparedStatement[] = []
  for (const item of payload.items) {
    const existing = await env.DB.prepare(`SELECT ai.sha256,m.content_sha256,api.archive_filename,api.part_number FROM archive_items ai JOIN media m ON m.id=ai.media_id
      JOIN archive_plan_items api ON api.archive_job_id=ai.archive_job_id AND api.media_id=ai.media_id
      JOIN archive_plans ap ON ap.archive_job_id=api.archive_job_id AND ap.event_id=api.event_id AND ap.part_number=api.part_number AND ap.status='planned'
      WHERE ai.archive_job_id=? AND ai.media_id=?`).bind(jobId,item.mediaId).first<{ sha256:string|null;content_sha256:string|null;archive_filename:string;part_number:number }>()
    if (!existing) throw new HttpError(404, 'ARCHIVE_ITEM_NOT_FOUND', 'An archive checksum references media outside this inventory.')
    if (existing.archive_filename !== item.archiveFilename || existing.part_number !== item.partNumber) throw new HttpError(409,'ARCHIVE_CHECKSUM_PLAN_MISMATCH','The checksum assignment does not match the persisted shard plan.')
    const checksum = item.sha256.toLowerCase()
    if ((existing.sha256 && existing.sha256.toLowerCase() !== checksum) || (existing.content_sha256 && existing.content_sha256.toLowerCase() !== checksum)) {
      throw new HttpError(409, 'ARCHIVE_CHECKSUM_CONFLICT', 'A verified original checksum changed. Stop and investigate the source object.')
    }
    statements.push(env.DB.prepare(`UPDATE archive_items SET sha256=?,archive_filename=?,assigned_part=?,processed_at=?
      WHERE archive_job_id=? AND media_id=? AND (sha256 IS NULL OR lower(sha256)=?) AND EXISTS (
        SELECT 1 FROM archive_jobs aj WHERE aj.id=? AND aj.lease_owner=? AND aj.lease_generation=?
          AND aj.lease_expires_at>=? AND aj.status IN ('building','partial')
      )`).bind(checksum,item.archiveFilename,item.partNumber,now,jobId,item.mediaId,checksum,
        jobId,payload.builderId,payload.leaseGeneration,now))
    statements.push(env.DB.prepare(`UPDATE media SET content_sha256=?,checksum_verified_at=? WHERE id=? AND (content_sha256 IS NULL OR lower(content_sha256)=?) AND EXISTS (
      SELECT 1 FROM archive_items ai WHERE ai.archive_job_id=? AND ai.media_id=media.id AND ai.original_object_key=media.original_object_key AND ai.size_bytes=media.size_bytes
    ) AND EXISTS (SELECT 1 FROM archive_jobs aj WHERE aj.id=? AND aj.lease_owner=? AND aj.lease_generation=?
      AND aj.lease_expires_at>=? AND aj.status IN ('building','partial'))`)
      .bind(checksum,now,item.mediaId,checksum,jobId,jobId,payload.builderId,payload.leaseGeneration,now))
  }
  const results = await env.DB.batch(statements)
  if (results.some((result)=>!result.meta.changes)) {
    await requireBuilderLease(env, jobId, payload.builderId, payload.leaseGeneration)
    throw new HttpError(409, 'ARCHIVE_CHECKSUM_WRITE_CONFLICT', 'An archive item changed while its checksum was being recorded.', true)
  }
  return json(request, env, { updated: payload.items.length }, 200, { 'Cache-Control': 'no-store' })
}

export async function builderArchivePartRoute(request: Request, env: Env, jobId: string) {
  await requireArchiveBuilder(request, env)
  const payload = await parseJson<{ builderId?: string; leaseGeneration?: number; objectLeaseGeneration?:number; eventId?: string; partNumber?: number; objectKey?: string; filename?: string; sizeBytes?: number; sha256?: string; planSha256?: string; fileCount?: number }>(request)
  if (!payload.builderId || !payload.eventId || !Number.isInteger(payload.partNumber) || payload.partNumber! < 1 || !payload.objectKey?.startsWith(`archives/${jobId}/parts/`) ||
    payload.objectKey.includes('..') || !payload.filename || payload.filename.length > 180 || !Number.isSafeInteger(payload.sizeBytes) || payload.sizeBytes! < 1 ||
    !/^[a-f0-9]{64}$/i.test(payload.sha256 || '') || !/^[a-f0-9]{64}$/i.test(payload.planSha256 || '') || !Number.isInteger(payload.fileCount) || payload.fileCount! < 1) {
    throw new HttpError(400, 'INVALID_ARCHIVE_PART', 'The archive part registration is invalid.')
  }
  await requireBuilderLease(env, jobId, payload.builderId, payload.leaseGeneration)
  const objectLeaseGeneration = payload.objectLeaseGeneration ?? payload.leaseGeneration
  if (!Number.isInteger(objectLeaseGeneration) || objectLeaseGeneration! < 1 || objectLeaseGeneration! > payload.leaseGeneration!) {
    throw new HttpError(400, 'INVALID_OBJECT_LEASE_GENERATION', 'The uploaded part generation must not exceed the active lease generation.')
  }
  const persistedPlan = await env.DB.prepare(`SELECT plan_sha256,file_count FROM archive_plans WHERE archive_job_id=? AND event_id=? AND part_number=? AND status='planned'`)
    .bind(jobId,payload.eventId,payload.partNumber).first<{ plan_sha256:string;file_count:number }>()
  if (!persistedPlan || persistedPlan.plan_sha256 !== payload.planSha256!.toLowerCase() || persistedPlan.file_count !== payload.fileCount) throw new HttpError(409,'ARCHIVE_PART_PLAN_MISMATCH','Persist and finalize the exact deterministic shard plan before uploading its ZIP.')
  const membership = await env.DB.prepare(`SELECT ai.event_id,ai.event_slug,COUNT(*) AS count,MIN(CASE WHEN ai.sha256 IS NULL OR ai.assigned_part<>? THEN 0 ELSE 1 END) AS ready
    FROM archive_items ai JOIN media m ON m.id=ai.media_id WHERE ai.archive_job_id=? AND ai.event_id=? AND m.status NOT IN ('deleting','deleted','expired') AND m.deleted_at IS NULL`)
    .bind(payload.partNumber,jobId,payload.eventId).first<{ event_id:string;event_slug:string;count:number;ready:number }>()
  const assigned = await env.DB.prepare(`SELECT COUNT(*) AS count FROM archive_items ai JOIN media m ON m.id=ai.media_id
    WHERE ai.archive_job_id=? AND ai.event_id=? AND ai.assigned_part=? AND ai.sha256 IS NOT NULL AND m.status NOT IN ('deleting','deleted','expired') AND m.deleted_at IS NULL`)
    .bind(jobId,payload.eventId,payload.partNumber).first<{ count:number }>()
  if (!membership?.event_id || Number(assigned?.count || 0) !== payload.fileCount) throw new HttpError(409, 'ARCHIVE_PART_COVERAGE_MISMATCH', 'The part file count does not match its checksummed inventory assignments.')
  const expectedPrefix = `archives/${jobId}/parts/${membership.event_slug}/${payload.planSha256!.toLowerCase()}/lease-${objectLeaseGeneration}/`
  if (!payload.objectKey!.startsWith(expectedPrefix) || !safeArchivePath(payload.objectKey!)) throw new HttpError(400, 'INVALID_ARCHIVE_PART_KEY', 'Use an immutable object key containing this part plan hash.')
  const object = await env.MEDIA.head(payload.objectKey)
  if (!object || object.size !== payload.sizeBytes) throw new HttpError(409, 'ARCHIVE_PART_NOT_VERIFIED', 'The uploaded archive part could not be verified.', true)
  const now = new Date().toISOString()
  const id = `${jobId}:${payload.eventId}:${payload.partNumber}`
  const existing = await env.DB.prepare('SELECT plan_sha256 FROM archive_parts WHERE archive_job_id=? AND event_id=? AND part_number=? AND status=\'complete\'')
    .bind(jobId,payload.eventId,payload.partNumber).first<{ plan_sha256: string | null }>()
  if (existing?.plan_sha256 && existing.plan_sha256 !== payload.planSha256!.toLowerCase()) {
    throw new HttpError(409, 'ARCHIVE_PART_PLAN_CONFLICT', 'This part number was already built from a different deterministic plan.')
  }
  const registered = await env.DB.prepare(`INSERT INTO archive_parts(id,archive_job_id,event_id,part_number,object_key,filename,size_bytes,sha256,file_count,status,created_at,completed_at,plan_sha256)
    SELECT ?,?,?,?,?,?,?,?,?,'complete',?,?,? FROM archive_jobs aj
    WHERE aj.id=? AND aj.lease_owner=? AND aj.lease_generation=? AND aj.lease_expires_at>=? AND aj.status IN ('building','partial')
    ON CONFLICT(archive_job_id,event_id,part_number) DO UPDATE SET
    object_key=excluded.object_key,filename=excluded.filename,size_bytes=excluded.size_bytes,sha256=excluded.sha256,
    file_count=excluded.file_count,status='complete',completed_at=excluded.completed_at,plan_sha256=excluded.plan_sha256
    WHERE archive_parts.plan_sha256=excluded.plan_sha256`)
    .bind(id,jobId,payload.eventId,payload.partNumber,payload.objectKey,payload.filename,payload.sizeBytes,payload.sha256!.toLowerCase(),payload.fileCount,
      now,now,payload.planSha256!.toLowerCase(),jobId,payload.builderId,payload.leaseGeneration,now).run()
  if (!registered.meta.changes) {
    await requireBuilderLease(env,jobId,payload.builderId,payload.leaseGeneration)
    throw new HttpError(409,'ARCHIVE_PART_PLAN_CONFLICT','This part number was already registered with a different deterministic plan.')
  }
  return json(request, env, { registered: true, partId: id }, 200, { 'Cache-Control': 'no-store' })
}

export async function builderArchiveArtifactsRoute(request: Request, env: Env, jobId: string) {
  await requireArchiveBuilder(request, env)
  const payload = await parseJson<{ builderId?: string; leaseGeneration?: number; artifacts?: Array<{ kind: ArchiveArtifact['kind']; objectKey: string; filename: string; sizeBytes: number; sha256: string }> }>(request)
  if (!payload.builderId || !Array.isArray(payload.artifacts) || !payload.artifacts.length || payload.artifacts.length > 4 || payload.artifacts.some((artifact) =>
    !['manifest_json','manifest_csv','checksums','readme'].includes(artifact.kind) || artifact.objectKey !== `archives/${jobId}/metadata/${(artifact.sha256 || '').toLowerCase()}/${artifact.filename}` ||
    !safeArchivePath(artifact.objectKey) || !artifact.filename || artifact.filename.length > 180 || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1 || !/^[a-f0-9]{64}$/i.test(artifact.sha256))) {
    throw new HttpError(400, 'INVALID_ARCHIVE_ARTIFACTS', 'The archive artifact registration is invalid.')
  }
  await requireBuilderLease(env, jobId, payload.builderId, payload.leaseGeneration)
  const heads = await Promise.all(payload.artifacts.map((artifact) => env.MEDIA.head(artifact.objectKey)))
  if (heads.some((head,index) => !head || head.size !== payload.artifacts![index].sizeBytes)) throw new HttpError(409, 'ARCHIVE_ARTIFACT_NOT_VERIFIED', 'An uploaded archive artifact could not be verified.', true)
  const now = new Date().toISOString()
  const results = await env.DB.batch(payload.artifacts.map((artifact) => env.DB.prepare(`INSERT INTO archive_artifacts(id,archive_job_id,kind,object_key,filename,size_bytes,sha256,created_at)
    SELECT ?,?,?,?,?,?,?,? FROM archive_jobs aj WHERE aj.id=? AND aj.lease_owner=? AND aj.lease_generation=?
      AND aj.lease_expires_at>=? AND aj.status IN ('building','partial')
    ON CONFLICT(archive_job_id,kind) DO UPDATE SET object_key=excluded.object_key,filename=excluded.filename,
      size_bytes=excluded.size_bytes,sha256=excluded.sha256,created_at=excluded.created_at
    WHERE archive_artifacts.sha256=excluded.sha256`)
    .bind(`${jobId}:${artifact.kind}`,jobId,artifact.kind,artifact.objectKey,artifact.filename,artifact.sizeBytes,artifact.sha256.toLowerCase(),now,
      jobId,payload.builderId,payload.leaseGeneration,now)))
  if (results.some((result)=>!result.meta.changes)) {
    await requireBuilderLease(env,jobId,payload.builderId,payload.leaseGeneration)
    throw new HttpError(409,'ARCHIVE_ARTIFACT_CONFLICT','A deterministic archive artifact changed after it was registered.')
  }
  return json(request, env, { registered: payload.artifacts.length }, 200, { 'Cache-Control': 'no-store' })
}

export async function builderCompleteArchiveRoute(request: Request, env: Env, jobId: string) {
  await requireArchiveBuilder(request, env)
  const payload = await parseJson<{ builderId?: string; leaseGeneration?: number }>(request)
  if (!payload.builderId) throw new HttpError(400, 'BUILDER_ID_REQUIRED', 'Provide the archive builder ID.')
  await requireBuilderLease(env, jobId, payload.builderId, payload.leaseGeneration)
  const [remaining, deletedAfterBuild, artifacts, totals, uncovered, mismatchedParts, duplicateNames, partCount] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM archive_items ai JOIN media m ON m.id=ai.media_id
      WHERE ai.archive_job_id=? AND m.status NOT IN ('deleting','deleted','expired') AND m.deleted_at IS NULL AND ai.sha256 IS NULL`).bind(jobId).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM archive_items ai JOIN media m ON m.id=ai.media_id
      WHERE ai.archive_job_id=? AND (m.status IN ('deleting','deleted','expired') OR m.deleted_at IS NOT NULL) AND ai.processed_at IS NOT NULL`).bind(jobId).first<{ count: number }>(),
    env.DB.prepare('SELECT kind,object_key FROM archive_artifacts WHERE archive_job_id=?').bind(jobId).all<{ kind: ArchiveArtifact['kind']; object_key: string }>(),
    env.DB.prepare(`SELECT COUNT(*) AS files,COALESCE(SUM(ai.size_bytes),0) AS bytes FROM archive_items ai JOIN media m ON m.id=ai.media_id
      WHERE ai.archive_job_id=? AND m.status NOT IN ('deleting','deleted','expired') AND m.deleted_at IS NULL`).bind(jobId).first<{ files: number; bytes: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM archive_items ai JOIN media m ON m.id=ai.media_id
      WHERE ai.archive_job_id=? AND m.status NOT IN ('deleting','deleted','expired') AND m.deleted_at IS NULL AND
      (ai.sha256 IS NULL OR ai.archive_filename IS NULL OR ai.assigned_part IS NULL OR NOT EXISTS (
        SELECT 1 FROM archive_plan_items api JOIN archive_plans apl ON apl.archive_job_id=api.archive_job_id AND apl.event_id=api.event_id AND apl.part_number=api.part_number AND apl.status='planned'
        WHERE api.archive_job_id=ai.archive_job_id AND api.media_id=ai.media_id AND api.archive_filename=ai.archive_filename AND api.part_number=ai.assigned_part) OR NOT EXISTS (
        SELECT 1 FROM archive_parts ap WHERE ap.archive_job_id=ai.archive_job_id AND ap.event_id=ai.event_id AND ap.part_number=ai.assigned_part AND ap.status='complete'))`).bind(jobId).first<{ count:number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM archive_parts ap WHERE ap.archive_job_id=? AND ap.status='complete' AND ap.file_count<>(
      SELECT COUNT(*) FROM archive_items ai JOIN media m ON m.id=ai.media_id WHERE ai.archive_job_id=ap.archive_job_id AND ai.event_id=ap.event_id AND ai.assigned_part=ap.part_number AND ai.sha256 IS NOT NULL AND m.status NOT IN ('deleting','deleted','expired') AND m.deleted_at IS NULL)`)
      .bind(jobId).first<{ count:number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM (SELECT lower(ai.archive_filename) FROM archive_items ai JOIN media m ON m.id=ai.media_id
      WHERE ai.archive_job_id=? AND m.status NOT IN ('deleting','deleted','expired') AND m.deleted_at IS NULL GROUP BY lower(ai.archive_filename) HAVING COUNT(*)>1)`).bind(jobId).first<{ count:number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM archive_parts WHERE archive_job_id=? AND status='complete'").bind(jobId).first<{ count:number }>(),
  ])
  if (Number(deletedAfterBuild?.count || 0) > 0) throw new HttpError(409, 'ARCHIVE_MEDIA_DELETED_AFTER_BUILD', 'Media was deleted after a shard was built. Create a fresh archive to guarantee deletion consistency.')
  if (Number(remaining?.count || 0) > 0) throw new HttpError(409, 'ARCHIVE_ITEMS_REMAIN', 'Some archive items have not been checksummed and packaged.')
  if (Number(uncovered?.count || 0) > 0 || (Number(totals?.files || 0) > 0 && Number(partCount?.count || 0) === 0)) throw new HttpError(409, 'ARCHIVE_PARTS_INCOMPLETE', 'Every active inventory item must belong to a registered complete ZIP part.')
  if (Number(mismatchedParts?.count || 0) > 0) throw new HttpError(409, 'ARCHIVE_PART_COUNT_MISMATCH', 'A registered part file count does not match its inventory membership.')
  if (Number(duplicateNames?.count || 0) > 0) throw new HttpError(409, 'ARCHIVE_FILENAME_CONFLICT', 'Archive filenames must be unique within the inventory.')
  const artifactMap = new Map(artifacts.results.map((artifact) => [artifact.kind,artifact.object_key]))
  if (!['manifest_json','manifest_csv','checksums','readme'].every((kind) => artifactMap.has(kind as ArchiveArtifact['kind']))) {
    throw new HttpError(409, 'ARCHIVE_ARTIFACTS_INCOMPLETE', 'Upload every manifest artifact before completing the archive.')
  }
  const now = new Date().toISOString()
  const complete = await env.DB.prepare(`UPDATE archive_jobs SET status='complete',total_files=?,total_bytes=?,processed_files=?,processed_bytes=?,
    manifest_json_object_key=?,manifest_csv_object_key=?,checksums_object_key=?,readme_object_key=?,completed_at=?,updated_at=?,
    lease_owner=NULL,lease_expires_at=NULL,error_code=NULL,error_message=NULL WHERE id=? AND lease_owner=? AND lease_generation=? AND lease_expires_at>=? AND status IN ('building','partial')
    AND NOT EXISTS (
      SELECT 1 FROM archive_items ai JOIN media m ON m.id=ai.media_id
      WHERE ai.archive_job_id=archive_jobs.id AND ai.processed_at IS NOT NULL
        AND (m.status IN ('deleting','deleted','expired') OR m.deleted_at IS NOT NULL)
    )`)
    .bind(Number(totals?.files || 0),Number(totals?.bytes || 0),Number(totals?.files || 0),Number(totals?.bytes || 0),
      artifactMap.get('manifest_json'),artifactMap.get('manifest_csv'),artifactMap.get('checksums'),artifactMap.get('readme'),now,now,jobId,payload.builderId,payload.leaseGeneration,now).run()
  if (!complete.meta.changes) {
    await requireBuilderLease(env,jobId,payload.builderId,payload.leaseGeneration)
    throw new HttpError(409, 'ARCHIVE_MEDIA_DELETED_AFTER_BUILD', 'Media was deleted while the archive was being completed. Create a fresh archive to guarantee deletion consistency.')
  }
  return json(request, env, { complete: true }, 200, { 'Cache-Control': 'no-store' })
}
