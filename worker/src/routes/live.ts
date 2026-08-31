import type { EventSlug } from '../../../shared/contracts'
import type { Env } from '../env'
import { json } from '../lib/http'

export async function liveConfigRoute(request: Request,env: Env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key='live_wall_source'").first<{ value: string }>()
  const source = ['all','solemnisation','reception'].includes(row?.value || '') ? row!.value as 'all' | EventSlug : 'all'
  return json(request,env,{ source },200,{ 'Cache-Control':'public, max-age=15' })
}
