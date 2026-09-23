import type { AdminGalleryVisibility, EventSlug, GalleryEvent, GalleryVisibilitySetting, PublicGalleryConfig } from '../../../shared/contracts'
import { isGalleryVisibilitySetting, PUBLIC_CONFIG_MAX_AGE_MS, resolveGalleryVisibility, visibleEventSlugs } from '../../../shared/visibility'
import type { Env } from '../env'
import { HttpError } from './http'
import { base64url, textEncoder } from '../security/hash'

export const VISIBILITY_SETTING_KEY = 'gallery_visibility'
export type GalleryPolicy = { visibility: AdminGalleryVisibility; uploadsEnabled: boolean; slugs: EventSlug[] }
export type PublicEventRow = { id: string; slug: EventSlug; name: string; event_date: string; display_name: string }

export function parseVisibilitySetting(value: string | undefined | null): GalleryVisibilitySetting {
  try {
    const setting: unknown = JSON.parse(value ?? '')
    if (isGalleryVisibilitySetting(setting)) return setting
  } catch { /* Missing and corrupt policy must never expose both days. */ }
  throw new HttpError(503, 'GALLERY_CONFIG_UNAVAILABLE', 'The gallery is temporarily unavailable. Please try again.', true)
}

export async function readGalleryPolicy(env: Env, now?: number): Promise<GalleryPolicy> {
  const [row, uploads] = await Promise.all([
    env.DB.prepare("SELECT value,updated_at FROM settings WHERE key = 'gallery_visibility'").first<{ value: string; updated_at: string }>(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'uploads_enabled'").first<{ value: string }>(),
  ])
  const visibility = resolveGalleryVisibility(parseVisibilitySetting(row?.value), now ?? Date.now(), row?.updated_at)
  return { visibility, uploadsEnabled: uploads?.value !== 'false', slugs: visibleEventSlugs(visibility.effectiveMode) }
}

export function publicEvent(row: PublicEventRow, uploadsEnabled: boolean): GalleryEvent {
  return { id: row.id, slug: row.slug, name: 'Our Wedding', eventDate: row.event_date, displayName: row.display_name, uploadEnabled: uploadsEnabled }
}

export async function readPublicGalleryConfig(env: Env): Promise<PublicGalleryConfig> {
  const events = await env.DB.prepare('SELECT id,slug,name,event_date,display_name FROM events ORDER BY event_date').all<PublicEventRow>()
  const policy = await readGalleryPolicy(env)
  const now = Date.parse(policy.visibility.serverTime)
  const { visibility, uploadsEnabled, slugs } = policy
  const transition = visibility.nextTransitionAt ? Date.parse(visibility.nextTransitionAt) : Infinity
  const publicEvents = events.results.filter((event) => slugs.includes(event.slug)).map((event) => publicEvent(event, uploadsEnabled))
  const revision = base64url(await crypto.subtle.digest('SHA-256', textEncoder.encode(JSON.stringify([visibility.revision, uploadsEnabled, publicEvents]))))
  return {
    mode: visibility.effectiveMode,
    events: publicEvents,
    uploadsEnabled, serverTime: visibility.serverTime, nextTransitionAt: visibility.nextTransitionAt,
    revision,
    validUntil: new Date(Math.min(now + PUBLIC_CONFIG_MAX_AGE_MS, transition)).toISOString(),
  }
}

export function visibleMediaPredicate(policy: GalleryPolicy, alias = 'e') {
  return { clause: `${alias}.slug IN (${policy.slugs.map(() => '?').join(',')})`, bindings: policy.slugs }
}
