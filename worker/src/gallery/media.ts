import type { EventSlug, GalleryCategory, GalleryMedia } from '../../../shared/contracts'
import type { Env } from '../env'
import { signedGet } from '../r2/signing'

export const PUBLIC_MEDIA_PREDICATE = `m.status = 'approved' AND m.deleted_at IS NULL AND
  (m.media_type='video' OR (m.display_object_key IS NOT NULL AND m.thumbnail_object_key IS NOT NULL))`

export const PUBLIC_MEDIA_COLUMNS = `m.id,m.media_type,m.mime_type,m.original_object_key,m.display_object_key,
  m.thumbnail_object_key,m.width,m.height,m.duration_seconds,m.guest_name,m.guest_message,m.manual_alt_text,
  m.source,m.created_at,m.face_search_enabled,
  e.id AS event_id,e.slug AS event_slug,e.name AS event_name,e.event_date,
  e.display_name AS event_display_name,e.upload_enabled AS event_upload_enabled,
  ma.caption AS ai_caption,
  COALESCE((SELECT json_group_array(json_object(
    'id',c.id,'slug',c.slug,'displayName',c.display_name,'confidence',mc.confidence,'source',mc.source
  )) FROM media_categories mc JOIN categories c ON c.id=mc.category_id
    WHERE mc.media_id=m.id AND c.enabled=1 AND
      (mc.source='admin' OR NOT EXISTS (
        SELECT 1 FROM media_category_suppressions mcs WHERE mcs.media_id=m.id AND mcs.category_id=mc.category_id
      ))), '[]') AS categories_json`

export type PublicMediaRow = {
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
  manual_alt_text: string | null
  source: 'guest' | 'photographer'
  created_at: string
  face_search_enabled: number
  event_id: string
  event_slug: EventSlug
  event_name: string
  event_date: string
  event_display_name: string
  event_upload_enabled: number
  ai_caption: string | null
  categories_json: string
}

function parseCategories(value: string): GalleryCategory[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    const categories: GalleryCategory[] = []
    const seen = new Set<string>()
    for (const value of parsed) {
      if (!value || typeof value !== 'object') continue
      const category = value as Record<string, unknown>
      if (typeof category.id !== 'string' || typeof category.slug !== 'string' || typeof category.displayName !== 'string' || seen.has(category.slug)) continue
      seen.add(category.slug)
      categories.push({
        id: category.id,
        slug: category.slug,
        displayName: category.displayName,
        confidence: typeof category.confidence === 'number' ? category.confidence : null,
        source: category.source === 'admin' ? 'admin' : 'ai',
      })
    }
    return categories
  } catch { return [] }
}

function meaningfulText(value: string | null) {
  const text = value?.trim()
  return text && !/^(?:photo|image|video|wedding picture)$/i.test(text) ? text : null
}

export async function mapPublicMedia(env: Env, row: PublicMediaRow): Promise<GalleryMedia> {
  const displayKey = row.media_type === 'video' ? row.original_object_key : row.display_object_key!
  const fallback = row.media_type === 'video'
    ? `Wedding video from ${row.event_display_name}.`
    : `Wedding memory from ${row.event_display_name}.`
  return {
    id: row.id,
    event: {
      id: row.event_id,
      slug: row.event_slug,
      name: row.event_name,
      eventDate: row.event_date,
      displayName: row.event_display_name,
      uploadEnabled: Boolean(row.event_upload_enabled),
    },
    mediaType: row.media_type,
    mimeType: row.mime_type,
    thumbnailUrl: row.thumbnail_object_key ? await signedGet(env, row.thumbnail_object_key, 900) : '',
    displayUrl: await signedGet(env, displayKey, 900),
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    guestName: row.guest_name,
    guestMessage: row.guest_message,
    altText: meaningfulText(row.manual_alt_text) || meaningfulText(row.guest_message) || meaningfulText(row.ai_caption) || fallback,
    aiCaption: row.ai_caption,
    categories: parseCategories(row.categories_json),
    source: row.source,
    createdAt: row.created_at,
  }
}

export type PublicMediaFilter = {
  requireFaceEnabled?: boolean
  event?: string
  type?: 'photo' | 'video'
  source?: 'guest' | 'photographer'
  category?: string
}

export async function publicMediaByIds(env: Env, ids: string[], filter: PublicMediaFilter = {}) {
  const uniqueIds = [...new Set(ids)]
  const rows: PublicMediaRow[] = []
  for (let offset = 0; offset < uniqueIds.length; offset += 80) {
    const chunk = uniqueIds.slice(offset, offset + 80)
    if (!chunk.length) continue
    const placeholders = chunk.map(() => '?').join(',')
    const clauses = [PUBLIC_MEDIA_PREDICATE, `m.id IN (${placeholders})`]
    const bindings: unknown[] = [...chunk]
    if (filter.requireFaceEnabled) clauses.push('m.face_search_enabled=1')
    if (filter.event) { clauses.push('e.slug=?'); bindings.push(filter.event) }
    if (filter.type) { clauses.push('m.media_type=?'); bindings.push(filter.type) }
    if (filter.source) { clauses.push('m.source=?'); bindings.push(filter.source) }
    if (filter.category) {
      clauses.push(`EXISTS (SELECT 1 FROM media_categories mc_filter JOIN categories c_filter ON c_filter.id=mc_filter.category_id
        WHERE mc_filter.media_id=m.id AND c_filter.slug=? AND c_filter.enabled=1 AND
        (mc_filter.source='admin' OR NOT EXISTS (SELECT 1 FROM media_category_suppressions s_filter
          WHERE s_filter.media_id=m.id AND s_filter.category_id=mc_filter.category_id)))`)
      bindings.push(filter.category)
    }
    const result = await env.DB.prepare(`SELECT ${PUBLIC_MEDIA_COLUMNS}
      FROM media m JOIN events e ON e.id=m.event_id LEFT JOIN media_ai ma ON ma.media_id=m.id
      WHERE ${clauses.join(' AND ')}`)
      .bind(...bindings).all<PublicMediaRow>()
    rows.push(...result.results)
  }
  const mapped = await Promise.all(rows.map((row) => mapPublicMedia(env, row)))
  return new Map(mapped.map((media) => [media.id, media]))
}
