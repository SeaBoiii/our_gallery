import type { GalleryPage } from '../../../shared/contracts'
import type { Env } from '../env'
import { mapPublicMedia, PUBLIC_MEDIA_COLUMNS, PUBLIC_MEDIA_PREDICATE, type PublicMediaRow } from '../gallery/media'
import { base64url, fromBase64url, textEncoder } from '../security/hash'
import { HttpError, json } from '../lib/http'
import { signedDownload } from '../r2/signing'

function encodeCursor(row: PublicMediaRow) { return base64url(textEncoder.encode(JSON.stringify({ createdAt: row.created_at, id: row.id }))) }
function decodeCursor(value: string | null) {
  if (!value) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(value))) as { createdAt: string; id: string }
    if (!parsed.createdAt || !/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error()
    return parsed
  } catch { throw new HttpError(400, 'INVALID_CURSOR', 'The gallery page cursor is invalid.') }
}

export async function galleryRoute(request: Request, env: Env) {
  const url = new URL(request.url)
  const event = url.searchParams.get('event')
  const type = url.searchParams.get('type')
  const category = url.searchParams.get('category')
  const source = url.searchParams.get('source')
  if (event && !['solemnisation','reception'].includes(event)) throw new HttpError(400, 'INVALID_EVENT', 'Unknown gallery event.')
  if (type && !['photo','video'].includes(type)) throw new HttpError(400, 'INVALID_MEDIA_TYPE', 'Unknown media type.')
  if (category && !/^[a-z0-9-]{1,64}$/.test(category)) throw new HttpError(400, 'INVALID_CATEGORY', 'Unknown gallery category.')
  if (source && !['guest','photographer'].includes(source)) throw new HttpError(400, 'INVALID_SOURCE', 'Unknown media source.')
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 30))
  const cursor = decodeCursor(url.searchParams.get('cursor'))
  const clauses = [PUBLIC_MEDIA_PREDICATE]
  const bindings: unknown[] = []
  if (event) { clauses.push('e.slug = ?'); bindings.push(event) }
  if (type) { clauses.push('m.media_type = ?'); bindings.push(type) }
  if (source) { clauses.push('m.source = ?'); bindings.push(source) }
  if (category) {
    clauses.push(`EXISTS (SELECT 1 FROM media_categories mc_filter JOIN categories c_filter ON c_filter.id=mc_filter.category_id
      WHERE mc_filter.media_id=m.id AND c_filter.slug=? AND c_filter.enabled=1 AND
      (mc_filter.source='admin' OR NOT EXISTS (SELECT 1 FROM media_category_suppressions mcs_filter
        WHERE mcs_filter.media_id=m.id AND mcs_filter.category_id=mc_filter.category_id)))`)
    bindings.push(category)
  }
  if (cursor) { clauses.push('(m.created_at < ? OR (m.created_at = ? AND m.id < ?))'); bindings.push(cursor.createdAt, cursor.createdAt, cursor.id) }
  const result = await env.DB.prepare(`SELECT ${PUBLIC_MEDIA_COLUMNS}
    FROM media m JOIN events e ON e.id=m.event_id LEFT JOIN media_ai ma ON ma.media_id=m.id
    WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC,m.id DESC LIMIT ?`)
    .bind(...bindings, limit + 1).all<PublicMediaRow>()
  const hasMore = result.results.length > limit
  const rows = result.results.slice(0, limit)
  const page: GalleryPage = { items: await Promise.all(rows.map((row) => mapPublicMedia(env, row))), nextCursor: hasMore && rows.length ? encodeCursor(rows[rows.length - 1]) : null }
  return json(request, env, page, 200, { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' })
}

export async function galleryDetailRoute(request: Request, env: Env, mediaId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  const row = await env.DB.prepare(`SELECT ${PUBLIC_MEDIA_COLUMNS}
    FROM media m JOIN events e ON e.id=m.event_id LEFT JOIN media_ai ma ON ma.media_id=m.id
    WHERE m.id=? AND ${PUBLIC_MEDIA_PREDICATE}`).bind(mediaId).first<PublicMediaRow>()
  if (!row) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  return json(request, env, await mapPublicMedia(env, row), 200, { 'Cache-Control': 'public, max-age=15' })
}

export async function galleryDownloadRoute(request: Request, env: Env, mediaId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  const row = await env.DB.prepare(`SELECT m.original_object_key,m.original_filename FROM media m WHERE m.id=? AND ${PUBLIC_MEDIA_PREDICATE}`)
    .bind(mediaId).first<{ original_object_key: string; original_filename: string }>()
  if (!row) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')
  return json(request, env, { url: await signedDownload(env, row.original_object_key, row.original_filename, 300), expiresInSeconds: 300 }, 200, { 'Cache-Control': 'no-store' })
}
