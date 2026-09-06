import type { EventSlug } from '../../../shared/contracts'
import type { Env } from '../env'
import { json } from '../lib/http'
import { readOperationalSettings } from '../settings'

export async function liveConfigRoute(request: Request,env: Env) {
  const [row,settings] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key='live_wall_source'").first<{ value: string }>(),
    readOperationalSettings(env),
  ])
  const source = ['all','solemnisation','reception'].includes(row?.value || '') ? row!.value as 'all' | EventSlug : 'all'
  return json(request,env,{ source, enabled: settings.eventMode === 'live' },200,{ 'Cache-Control':'public, max-age=15' })
}
