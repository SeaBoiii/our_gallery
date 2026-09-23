import type { AdminMedia, AdminMediaPage, AdminSession, AdminSettingsUpdate, AdminStats, EventSlug, GallerySettings, MediaStatus } from '../../../shared/contracts'
import { applyGalleryVisibilityUpdate, DEFAULT_GALLERY_VISIBILITY, isGalleryDayMode, resolveGalleryVisibility } from '../../../shared/visibility'
import type { Env } from '../env'
import { HttpError, isHttpError, json, parseJson, requireOrigin } from '../lib/http'
import { signedGet } from '../r2/signing'
import { clearAdminCookie, createAdminSession, requireAdmin, revokeAdminSession, verifyAdminPassword } from '../security/adminSession'
import { clientIp, rateLimit } from '../security/rateLimit'
import { parseVisibilitySetting } from '../lib/galleryVisibility'

type AdminMediaRow = {
  id: string; event_slug: EventSlug; event_display_name: string; media_type: 'photo' | 'video'; mime_type: string; original_object_key: string; display_object_key: string | null; thumbnail_object_key: string | null; original_filename: string; guest_name: string | null; guest_message: string | null; status: MediaStatus; derivative_status: AdminMedia['derivativeStatus']; size_bytes: number; created_at: string
}

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }

export async function adminLoginRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const payload = await parseJson<{ password?: string }>(request)
  const ip = clientIp(request)
  await rateLimit(env, `admin-ip:${ip}`, 'admin_login', 10, 900)
  if (!await verifyAdminPassword(env, payload.password || '')) throw new HttpError(401, 'INVALID_CREDENTIALS', 'The password is incorrect.')
  const session = await createAdminSession(env)
  await env.DB.prepare('INSERT INTO audit_log (id, actor, action, target_id, metadata_json, created_at) VALUES (?, ?, ?, NULL, NULL, ?)').bind(crypto.randomUUID(), 'admin', 'login', new Date().toISOString()).run()
  const data: AdminSession = { authenticated: true, expiresAt: session.expiresAt }
  return json(request, env, data, 200, { 'Set-Cookie': session.cookie, 'Cache-Control': 'no-store' })
}

export async function adminLogoutRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  try { await revokeAdminSession(request, env) } catch (error) {
    // An expired/revoked session is already signed out; still clear its cookie.
    if (!isHttpError(error) || error.status !== 401) throw error
  }
  return json(request, env, { authenticated: false }, 200, { 'Set-Cookie': clearAdminCookie(env), 'Cache-Control': 'no-store' })
}

export async function adminSessionRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  try {
    const session = await requireAdmin(request, env)
    return json(request, env, { authenticated: true, expiresAt: session.expiresAt }, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (isHttpError(error) && error.status === 401) return json(request, env, { authenticated: false }, 200, { 'Cache-Control': 'no-store' })
    throw error
  }
}

export async function adminStatsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  const row = await env.DB.prepare(`SELECT
    COUNT(*) AS total_uploads,
    SUM(CASE WHEN media_type='photo' THEN 1 ELSE 0 END) AS total_photos,
    SUM(CASE WHEN media_type='video' THEN 1 ELSE 0 END) AS total_videos,
    SUM(CASE WHEN date(created_at,'+8 hours')=date('now','+8 hours') THEN 1 ELSE 0 END) AS uploads_today,
    SUM(CASE WHEN event_id='event-solemnisation' THEN 1 ELSE 0 END) AS day_one,
    SUM(CASE WHEN event_id='event-reception' THEN 1 ELSE 0 END) AS day_two,
    SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
    SUM(CASE WHEN derivative_status IN ('partial','unavailable') AND media_type='photo' THEN 1 ELSE 0 END) AS derivative_failures,
    COALESCE(SUM(size_bytes+display_size_bytes+thumbnail_size_bytes),0) AS total_bytes,
    COALESCE(SUM(size_bytes),0) AS original_bytes,
    COALESCE(SUM(display_size_bytes),0) AS display_bytes,
    COALESCE(SUM(thumbnail_size_bytes),0) AS thumbnail_bytes,
    COALESCE(SUM(CASE WHEN media_type='photo' THEN size_bytes+display_size_bytes+thumbnail_size_bytes ELSE 0 END),0) AS photo_bytes,
    COALESCE(SUM(CASE WHEN media_type='video' THEN size_bytes ELSE 0 END),0) AS video_bytes
    FROM media WHERE status NOT IN ('deleted','expired')`).first<Record<string, number>>()
  const number = (key: string) => Number(row?.[key] || 0)
  const hardGb = Number(env.HARD_STORAGE_LIMIT_GB)
  const stats: AdminStats = {
    totalUploads: number('total_uploads'), totalPhotos: number('total_photos'), totalVideos: number('total_videos'), uploadsToday: number('uploads_today'), dayOne: number('day_one'), dayTwo: number('day_two'), approved: number('approved'), pending: number('pending'), rejected: number('rejected'), derivativeFailures: number('derivative_failures'),
    storage: { totalBytes: number('total_bytes'), originalBytes: number('original_bytes'), displayBytes: number('display_bytes'), thumbnailBytes: number('thumbnail_bytes'), photoBytes: number('photo_bytes'), videoBytes: number('video_bytes'), referenceTargetBytes: 500 * 1024 ** 3, softWarningBytes: (Number(env.SOFT_STORAGE_WARNING_GB) || 450) * 1024 ** 3, hardLimitBytes: Number.isFinite(hardGb) && hardGb > 0 ? hardGb * 1024 ** 3 : null },
  }
  return json(request, env, stats, 200, { 'Cache-Control': 'no-store' })
}

function encodeCursor(row: AdminMediaRow) { return btoa(JSON.stringify({ createdAt: row.created_at, id: row.id })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') }
function decodeCursor(value: string | null) {
  if (!value) return null
  try { const normalized = value.replace(/-/g,'+').replace(/_/g,'/'); const result = JSON.parse(atob(normalized + '='.repeat((4-normalized.length%4)%4))) as { createdAt: string; id: string }; if (!result.createdAt || !validUuid(result.id)) throw new Error(); return result }
  catch { throw new HttpError(400, 'INVALID_CURSOR', 'The moderation cursor is invalid.') }
}

async function mapAdminMedia(env: Env, row: AdminMediaRow): Promise<AdminMedia> {
  return {
    id: row.id, eventSlug: row.event_slug, eventDisplayName: row.event_display_name, mediaType: row.media_type, mimeType: row.mime_type, originalFilename: row.original_filename, guestName: row.guest_name, guestMessage: row.guest_message, status: row.status, derivativeStatus: row.derivative_status, sizeBytes: row.size_bytes, createdAt: row.created_at,
    thumbnailUrl: row.thumbnail_object_key ? await signedGet(env, row.thumbnail_object_key, 600) : null,
    originalDownloadUrl: await signedGet(env, row.original_object_key, 300),
  }
}

export async function adminMediaRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const event = url.searchParams.get('event')
  const type = url.searchParams.get('type')
  if (status && !['uploading','reconciling','pending','approved','rejected','deleting','deleted','expired'].includes(status)) throw new HttpError(400, 'INVALID_STATUS', 'Unknown moderation status.')
  if (event && !['solemnisation','reception'].includes(event)) throw new HttpError(400, 'INVALID_EVENT', 'Unknown event.')
  if (type && !['photo','video'].includes(type)) throw new HttpError(400, 'INVALID_TYPE', 'Unknown media type.')
  const cursor = decodeCursor(url.searchParams.get('cursor'))
  const clauses = ["m.status NOT IN ('deleted','expired')"]
  const bindings: unknown[] = []
  if (status) { clauses.push('m.status=?'); bindings.push(status) }
  if (event) { clauses.push('e.slug=?'); bindings.push(event) }
  if (type) { clauses.push('m.media_type=?'); bindings.push(type) }
  if (cursor) { clauses.push('(m.created_at < ? OR (m.created_at = ? AND m.id < ?))'); bindings.push(cursor.createdAt,cursor.createdAt,cursor.id) }
  const result = await env.DB.prepare(`SELECT m.id,m.media_type,m.mime_type,m.original_object_key,m.display_object_key,m.thumbnail_object_key,m.original_filename,m.guest_name,m.guest_message,m.status,m.derivative_status,m.size_bytes,m.created_at,e.slug AS event_slug,e.display_name AS event_display_name
    FROM media m JOIN events e ON e.id=m.event_id WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC,m.id DESC LIMIT 31`).bind(...bindings).all<AdminMediaRow>()
  const rows = result.results.slice(0,30)
  const page: AdminMediaPage = { items: await Promise.all(rows.map((row) => mapAdminMedia(env,row))), nextCursor: result.results.length > 30 && rows.length ? encodeCursor(rows[rows.length-1]) : null }
  return json(request, env, page, 200, { 'Cache-Control': 'no-store' })
}

export async function adminBatchMediaRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  const payload = await parseJson<{ ids?: string[]; status?: 'approved' | 'rejected' }>(request)
  if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 100 || payload.ids.some((id) => !validUuid(id)) || !['approved','rejected'].includes(payload.status || '')) throw new HttpError(400, 'INVALID_MODERATION', 'Choose up to 100 valid memories and a moderation action.')
  const status = payload.status!
  const timestampColumn = status === 'approved' ? 'approved_at' : 'rejected_at'
  const now = new Date().toISOString()
  const chunks = Array.from({ length: Math.ceil(payload.ids.length / 98) }, (_, index) => payload.ids!.slice(index * 98, index * 98 + 98))
  const results = await env.DB.batch(chunks.map((ids) => {
    const placeholders = ids.map(() => '?').join(',')
    return env.DB.prepare(`UPDATE media SET status=?, ${timestampColumn}=? WHERE id IN (${placeholders}) AND status IN ('pending','approved','rejected')`).bind(status,now,...ids)
  }))
  const updated = results.reduce((sum, result) => sum + Number(result.meta.changes || 0), 0)
  await env.DB.prepare('INSERT INTO audit_log (id,actor,action,target_id,metadata_json,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),`session:${admin.sessionHash.slice(0,12)}`,`batch_${status}`,null,JSON.stringify({ count:updated }),now).run()
  return json(request, env, { updated }, 200, { 'Cache-Control': 'no-store' })
}

export async function adminDeleteMediaRoute(request: Request, env: Env, mediaId: string) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  if (!validUuid(mediaId)) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  const row = await env.DB.prepare("SELECT staging_original_object_key,staging_display_object_key,staging_thumbnail_object_key,original_object_key,display_object_key,thumbnail_object_key,status FROM media WHERE id=? AND status NOT IN ('deleted','expired')").bind(mediaId).first<{ staging_original_object_key: string; staging_display_object_key: string | null; staging_thumbnail_object_key: string | null; original_object_key: string; display_object_key: string | null; thumbnail_object_key: string | null; status: string }>()
  if (!row) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  const now = new Date().toISOString()
  const claim = await env.DB.prepare("UPDATE media SET status='deleting',deleted_at=? WHERE id=? AND status NOT IN ('deleting','deleted','expired')").bind(now,mediaId).run()
  if (!claim.meta.changes && row.status !== 'deleting') throw new HttpError(409, 'DELETE_CONFLICT', 'This memory changed while it was being deleted.', true)
  const keys = [row.staging_original_object_key,row.staging_display_object_key,row.staging_thumbnail_object_key,row.original_object_key,row.display_object_key,row.thumbnail_object_key].filter((key): key is string => Boolean(key))
  await env.MEDIA.delete(keys)
  await env.DB.prepare("UPDATE media SET status='deleted',deleted_at=? WHERE id=? AND status='deleting'").bind(now,mediaId).run()
  await env.DB.prepare('INSERT INTO audit_log (id,actor,action,target_id,metadata_json,created_at) VALUES (?,?,?,?,NULL,?)').bind(crypto.randomUUID(),`session:${admin.sessionHash.slice(0,12)}`,'delete',mediaId,now).run()
  return json(request, env, { deleted: true }, 200, { 'Cache-Control': 'no-store' })
}

async function readSettings(env: Env): Promise<GallerySettings> {
  const [settings, events] = await Promise.all([
    env.DB.prepare('SELECT key,value,updated_at FROM settings').all<{ key: string; value: string; updated_at: string }>(),
    env.DB.prepare('SELECT id,slug,name,event_date,display_name,upload_enabled FROM events ORDER BY event_date').all<{ id: string; slug: EventSlug; name: string; event_date: string; display_name: string; upload_enabled: number }>(),
  ])
  const values = new Map(settings.results.map((row) => [row.key,row.value]))
  const autoApproveValue = values.get('auto_approve_uploads')
  const uploadsEnabled = values.get('uploads_enabled') !== 'false'
  const visibility = resolveGalleryVisibility(parseVisibilitySetting(values.get('gallery_visibility')), Date.now(), settings.results.find((row) => row.key === 'gallery_visibility')?.updated_at)
  return { visibility, uploadsEnabled, autoApproveUploads: autoApproveValue === 'true' || (autoApproveValue !== 'false' && env.AUTO_APPROVE_UPLOADS === 'true'), greetingsEnabled: values.get('greetings_enabled') !== 'false', liveWallSource: (values.get('live_wall_source') || 'all') as GallerySettings['liveWallSource'], events: events.results.map((row) => ({ id: row.id,slug: row.slug,name: 'Our Wedding',eventDate: row.event_date,displayName: row.display_name,uploadEnabled: uploadsEnabled })) }
}

export async function adminSettingsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  return json(request, env, await readSettings(env), 200, { 'Cache-Control': 'no-store' })
}

export async function adminUpdateSettingsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  const payload = await parseJson<AdminSettingsUpdate>(request)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some((key) => !['uploadsEnabled','autoApproveUploads','greetingsEnabled','liveWallSource','visibility'].includes(key))) {
    throw new HttpError(400, 'INVALID_SETTINGS', 'Unknown gallery setting. Please refresh the admin page.')
  }
  for (const key of ['uploadsEnabled','autoApproveUploads','greetingsEnabled'] as const) {
    if (key in payload && typeof payload[key] !== 'boolean') throw new HttpError(400, 'INVALID_SETTINGS', 'Settings must use a valid enabled or disabled value.')
  }
  const statements: D1PreparedStatement[] = []
  const now = new Date().toISOString()
  if (typeof payload.uploadsEnabled === 'boolean') statements.push(env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES('uploads_enabled',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(String(payload.uploadsEnabled),now))
  if (typeof payload.autoApproveUploads === 'boolean') statements.push(env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES('auto_approve_uploads',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(String(payload.autoApproveUploads),now))
  if (typeof payload.greetingsEnabled === 'boolean') statements.push(env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES('greetings_enabled',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(String(payload.greetingsEnabled),now))
  if ('liveWallSource' in payload) {
    if (!['all','solemnisation','reception'].includes(payload.liveWallSource || '')) throw new HttpError(400,'INVALID_LIVE_SOURCE','Unknown live wall source.')
    statements.push(env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES('live_wall_source',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(payload.liveWallSource,now))
  }
  if ('visibility' in payload) {
    const update = payload.visibility
    if (!update || typeof update !== 'object' || Array.isArray(update)
      || !['automatic','manual'].includes(update.control)
      || Object.keys(update).some((key) => key !== 'control' && !(update.control === 'manual' && key === 'mode'))
      || (update.control === 'manual' && !isGalleryDayMode(update.mode))) {
      throw new HttpError(400, 'INVALID_VISIBILITY', 'Choose automatic control or one valid gallery day mode.')
    }
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'gallery_visibility'").first<{ value: string }>()
    let current = DEFAULT_GALLERY_VISIBILITY
    try { current = parseVisibilitySetting(row?.value) } catch { /* An authenticated explicit update can repair a broken policy. */ }
    const next = applyGalleryVisibilityUpdate(current, update)
    statements.push(env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES('gallery_visibility',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(next),now))
  }
  if (!statements.length) throw new HttpError(400,'NO_SETTINGS','No settings were provided.')
  statements.push(env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),`session:${admin.sessionHash.slice(0,12)}`,'settings_update',null,JSON.stringify(payload),now))
  await env.DB.batch(statements)
  return json(request, env, await readSettings(env), 200, { 'Cache-Control': 'no-store' })
}
