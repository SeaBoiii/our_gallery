import type { EventSlug, GalleryDownloadResponse, GalleryMedia, GalleryPage } from '../../../shared/contracts'
import type { Env } from '../env'
import { base64url, fromBase64url, textEncoder } from '../security/hash'
import { getGalleryDownloadStatus } from '../lib/downloadAvailability'
import { HttpError, json } from '../lib/http'
import { signedDownload, signedGet } from '../r2/signing'

type MediaRow = {
  id: string
  media_type: 'photo' | 'video'
  mime_type: string
  original_object_key: string
  display_object_key: string | null
  thumbnail_object_key: string | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  guest_name: string | null
  guest_message: string | null
  created_at: string
  event_id: string
  event_slug: EventSlug
  event_name: string
  event_date: string
  event_display_name: string
  event_upload_enabled: number
}

function encodeCursor(row: MediaRow) { return base64url(textEncoder.encode(JSON.stringify({ createdAt: row.created_at, id: row.id }))) }
function decodeCursor(value: string | null) {
  if (!value) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(value))) as { createdAt: string; id: string }
    if (!parsed.createdAt || !/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error()
    return parsed
  } catch { throw new HttpError(400, 'INVALID_CURSOR', 'The gallery page cursor is invalid.') }
}

async function mapMedia(env: Env, row: MediaRow): Promise<GalleryMedia> {
  const displayKey = row.media_type === 'video' ? row.original_object_key : row.display_object_key!
  return {
    id: row.id,
    event: { id: row.event_id, slug: row.event_slug, name: row.event_name, eventDate: row.event_date, displayName: row.event_display_name, uploadEnabled: Boolean(row.event_upload_enabled) },
    mediaType: row.media_type,
    mimeType: row.mime_type,
    thumbnailUrl: row.thumbnail_object_key ? await signedGet(env, row.thumbnail_object_key, 900) : '',
    displayUrl: await signedGet(env, displayKey, 900),
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    guestName: row.guest_name,
    guestMessage: row.guest_message,
    createdAt: row.created_at,
  }
}

export async function galleryRoute(request: Request, env: Env) {
  const url = new URL(request.url)
  const event = url.searchParams.get('event')
  const type = url.searchParams.get('type')
  if (event && !['solemnisation','reception'].includes(event)) throw new HttpError(400, 'INVALID_EVENT', 'Unknown gallery event.')
  if (type && !['photo','video'].includes(type)) throw new HttpError(400, 'INVALID_MEDIA_TYPE', 'Unknown media type.')
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 30))
  const cursor = decodeCursor(url.searchParams.get('cursor'))
  const clauses = ["m.status = 'approved'", "(m.media_type = 'video' OR (m.display_object_key IS NOT NULL AND m.thumbnail_object_key IS NOT NULL))"]
  const bindings: unknown[] = []
  if (event) { clauses.push('e.slug = ?'); bindings.push(event) }
  if (type) { clauses.push('m.media_type = ?'); bindings.push(type) }
  if (cursor) { clauses.push('(m.created_at < ? OR (m.created_at = ? AND m.id < ?))'); bindings.push(cursor.createdAt, cursor.createdAt, cursor.id) }
  const result = await env.DB.prepare(`SELECT m.id,m.media_type,m.mime_type,m.original_object_key,m.display_object_key,m.thumbnail_object_key,m.width,m.height,m.duration_seconds,m.guest_name,m.guest_message,m.created_at,
    e.id AS event_id,e.slug AS event_slug,e.name AS event_name,e.event_date,e.display_name AS event_display_name,e.upload_enabled AS event_upload_enabled
    FROM media m JOIN events e ON e.id = m.event_id WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC,m.id DESC LIMIT ?`)
    .bind(...bindings, limit + 1).all<MediaRow>()
  const hasMore = result.results.length > limit
  const rows = result.results.slice(0, limit)
  const page: GalleryPage = { items: await Promise.all(rows.map((row) => mapMedia(env, row))), nextCursor: hasMore && rows.length ? encodeCursor(rows[rows.length - 1]) : null }
  return json(request, env, page, 200, { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' })
}

export async function galleryDetailRoute(request: Request, env: Env, mediaId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  const row = await env.DB.prepare(`SELECT m.id,m.media_type,m.mime_type,m.original_object_key,m.display_object_key,m.thumbnail_object_key,m.width,m.height,m.duration_seconds,m.guest_name,m.guest_message,m.created_at,
    e.id AS event_id,e.slug AS event_slug,e.name AS event_name,e.event_date,e.display_name AS event_display_name,e.upload_enabled AS event_upload_enabled
    FROM media m JOIN events e ON e.id = m.event_id WHERE m.id = ? AND m.status = 'approved' AND (m.media_type = 'video' OR (m.display_object_key IS NOT NULL AND m.thumbnail_object_key IS NOT NULL))`).bind(mediaId).first<MediaRow>()
  if (!row) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  return json(request, env, await mapMedia(env, row), 200, { 'Cache-Control': 'public, max-age=15' })
}

export function galleryDownloadStatusRoute(request: Request, env: Env) {
  return json(request, env, getGalleryDownloadStatus(env.DOWNLOADS_AVAILABLE_AT), 200, { 'Cache-Control': 'no-store' })
}

export async function galleryDownloadRoute(request: Request, env: Env, mediaId: string) {
  const availability = getGalleryDownloadStatus(env.DOWNLOADS_AVAILABLE_AT)
  if (!availability.available) {
    throw new HttpError(403, 'DOWNLOADS_NOT_YET_AVAILABLE', 'Original downloads will be available after the celebrations.', false, { availableAt: availability.availableAt })
  }
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  const row = await env.DB.prepare(`SELECT m.original_object_key,m.original_filename FROM media m
    WHERE m.id=? AND m.status='approved' AND (m.media_type='video' OR (m.display_object_key IS NOT NULL AND m.thumbnail_object_key IS NOT NULL))`)
    .bind(mediaId).first<{ original_object_key: string; original_filename: string }>()
  if (!row) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  const ttl = 300
  const response: GalleryDownloadResponse = { url: await signedDownload(env, row.original_object_key, row.original_filename, ttl), expiresInSeconds: ttl }
  return json(request, env, response, 200, { 'Cache-Control': 'no-store' })
}
