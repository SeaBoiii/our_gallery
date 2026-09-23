import type { EventSlug } from '../../../shared/contracts'
import type { Env } from '../env'
import { json } from '../lib/http'
import { readGalleryPolicy } from '../lib/galleryVisibility'

export async function liveConfigRoute(request: Request,env: Env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key='live_wall_source'").first<{ value: string }>()
  const policy = await readGalleryPolicy(env)
  const configured = ['all','solemnisation','reception'].includes(row?.value || '') ? row!.value as 'all' | EventSlug : 'all'
  const source = policy.visibility.effectiveMode === 'both' ? configured : policy.visibility.effectiveMode
  return json(request,env,{ source },200,{ 'Cache-Control':'no-store' })
}
