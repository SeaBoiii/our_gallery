import type { Env } from './env'
import { assertSafeConfiguration } from './env'
import { HttpError, errorResponse, json, optionsResponse } from './lib/http'
import { adminBatchMediaRoute, adminDeleteMediaRoute, adminLoginRoute, adminLogoutRoute, adminMediaRoute, adminSessionRoute, adminSettingsRoute, adminStatsRoute, adminUpdateSettingsRoute } from './routes/admin'
import { eventsRoute } from './routes/events'
import { galleryDetailRoute, galleryRoute } from './routes/gallery'
import { liveConfigRoute } from './routes/live'
import { completeUploadRoute, prepareUploadsRoute, refreshUploadRoute } from './routes/uploads'
import { cleanupStaleUploads } from './scheduled/cleanup'

export async function fetchHandler(request: Request, env: Env) {
  try {
    assertSafeConfiguration(env)
    if (request.method === 'OPTIONS') return optionsResponse(request,env)
    const url = new URL(request.url)
    const { pathname } = url
    const contentLength = Number(request.headers.get('Content-Length') || 0)
    if (contentLength > 128 * 1024) throw new HttpError(413,'REQUEST_TOO_LARGE','The request is too large.')

    if (request.method === 'GET' && pathname === '/health') return json(request,env,{ status: 'ok', environment: env.ENVIRONMENT })
    if (request.method === 'GET' && pathname === '/api/events') return await eventsRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/gallery') return await galleryRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/live/config') return await liveConfigRoute(request,env)
    const galleryDetail = pathname.match(/^\/api\/gallery\/([0-9a-f-]{36})$/i)
    if (request.method === 'GET' && galleryDetail) return await galleryDetailRoute(request,env,galleryDetail[1])

    if (request.method === 'POST' && pathname === '/api/uploads/prepare') return await prepareUploadsRoute(request,env)
    const uploadComplete = pathname.match(/^\/api\/uploads\/([0-9a-f-]{36})\/complete$/i)
    if (request.method === 'POST' && uploadComplete) return await completeUploadRoute(request,env,uploadComplete[1])
    const uploadRefresh = pathname.match(/^\/api\/uploads\/([0-9a-f-]{36})\/refresh$/i)
    if (request.method === 'POST' && uploadRefresh) return await refreshUploadRoute(request,env,uploadRefresh[1])

    if (request.method === 'POST' && pathname === '/api/admin/login') return await adminLoginRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/admin/logout') return await adminLogoutRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/admin/session') return await adminSessionRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/admin/stats') return await adminStatsRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/admin/media') return await adminMediaRoute(request,env)
    if (request.method === 'PATCH' && pathname === '/api/admin/media/batch') return await adminBatchMediaRoute(request,env)
    const adminMedia = pathname.match(/^\/api\/admin\/media\/([0-9a-f-]{36})$/i)
    if (request.method === 'DELETE' && adminMedia) return await adminDeleteMediaRoute(request,env,adminMedia[1])
    if (request.method === 'GET' && pathname === '/api/admin/settings') return await adminSettingsRoute(request,env)
    if (request.method === 'PATCH' && pathname === '/api/admin/settings') return await adminUpdateSettingsRoute(request,env)

    throw new HttpError(404,'NOT_FOUND','This API route does not exist.')
  } catch (error) {
    return errorResponse(request,env,error)
  }
}

export default {
  fetch: fetchHandler,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    assertSafeConfiguration(env)
    await cleanupStaleUploads(env)
  },
} satisfies ExportedHandler<Env>
