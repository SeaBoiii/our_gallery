import type { Env } from '../env'
import { json } from '../lib/http'
import { readPublicGalleryConfig } from '../lib/galleryVisibility'

export async function eventsRoute(request: Request, env: Env) {
  const config = await readPublicGalleryConfig(env)
  return json(request, env, config.events, 200, { 'Cache-Control': 'no-store' })
}

export async function galleryConfigRoute(request: Request, env: Env) {
  return json(request, env, await readPublicGalleryConfig(env), 200, { 'Cache-Control': 'no-store' })
}
