import type { GalleryEvent } from '../../../shared/contracts'
import type { Env } from '../env'
import { json } from '../lib/http'
import { readOperationalSettings, uploadsAllowed } from '../settings'

type EventRow = { id: string; slug: 'solemnisation' | 'reception'; name: string; event_date: string; display_name: string; upload_enabled: number }

export async function eventsRoute(request: Request, env: Env) {
  const [result, globalSetting] = await Promise.all([
    env.DB.prepare('SELECT id, slug, name, event_date, display_name, upload_enabled FROM events ORDER BY event_date').all<EventRow>(),
    readOperationalSettings(env),
  ])
  const globallyEnabled = uploadsAllowed(globalSetting)
  const events: GalleryEvent[] = result.results.map((row) => ({ id: row.id, slug: row.slug, name: row.name, eventDate: row.event_date, displayName: row.display_name, uploadEnabled: globallyEnabled && Boolean(row.upload_enabled) }))
  return json(request, env, events, 200, { 'Cache-Control': 'public, max-age=60' })
}
