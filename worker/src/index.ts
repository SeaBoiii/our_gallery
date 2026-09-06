import type { Env } from './env'
import type { AiQueueMessage } from './ai/types'
import { consumeAiQueue, dispatchPendingAiJobs } from './ai/jobs'
export { MediaAnalysisWorkflow } from './ai/workflow'
import { assertSafeConfiguration } from './env'
import { HttpError, errorResponse, json, optionsResponse } from './lib/http'
import { adminBatchMediaRoute, adminDeleteMediaRoute, adminLoginRoute, adminLogoutRoute, adminMediaRoute, adminSessionRoute, adminSettingsRoute, adminStatsRoute, adminUpdateSettingsRoute } from './routes/admin'
import { eventsRoute } from './routes/events'
import { galleryDetailRoute, galleryDownloadRoute, galleryRoute } from './routes/gallery'
import { capabilitiesRoute, categoriesRoute, favouriteLookupRoute, semanticSearchRoute } from './routes/discovery'
import { findMeSearchRoute, findMeStatusRoute } from './routes/findMe'
import { liveConfigRoute } from './routes/live'
import { maintenancePurgeFacesRoute } from './routes/maintenance'
import { completeUploadRoute, prepareUploadsRoute, refreshUploadRoute } from './routes/uploads'
import { cleanupStaleUploads } from './scheduled/cleanup'
import {
  adminAiBackfillRoute,
  adminAiJobActionRoute,
  adminAiJobsRoute,
  adminAiStatsRoute,
  adminCategoryOverrideRoute,
  adminCompareFaceCalibrationRoute,
  adminFaceCalibrationsRoute,
  adminFaceToggleRoute,
  adminPurgeFacesRoute,
  adminSaveFaceCalibrationRoute,
} from './routes/adminAi'
import {
  adminArchiveDetailRoute,
  adminArchiveDownloadRoute,
  adminArchivesRoute,
  adminCancelArchiveRoute,
  adminCreateArchiveRoute,
  builderArchiveArtifactsRoute,
  builderArchiveChecksumsRoute,
  builderArchiveItemsRoute,
  builderArchiveJobRoute,
  builderArchivePartRoute,
  builderArchivePlanRoute,
  builderArchiveProgressRoute,
  builderClaimArchiveRoute,
  builderCompleteArchiveRoute,
} from './routes/adminArchive'

export async function fetchHandler(request: Request, env: Env, ctx?: ExecutionContext) {
  try {
    assertSafeConfiguration(env)
    if (request.method === 'OPTIONS') return optionsResponse(request,env)
    const url = new URL(request.url)
    const { pathname } = url
    const contentLength = Number(request.headers.get('Content-Length') || 0)
    const isBoundedImageRoute = request.method === 'POST' && (pathname === '/api/find-me/search' || pathname === '/api/admin/ai/face-calibrations/compare')
    if (!isBoundedImageRoute && contentLength > 128 * 1024) throw new HttpError(413,'REQUEST_TOO_LARGE','The request is too large.')

    if (request.method === 'GET' && pathname === '/health') return json(request,env,{ status: 'ok', environment: env.ENVIRONMENT })
    if (request.method === 'GET' && pathname === '/api/events') return await eventsRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/capabilities') return await capabilitiesRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/maintenance/ai/purge-faces') return await maintenancePurgeFacesRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/discovery/categories') return await categoriesRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/discovery/search') return await semanticSearchRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/gallery/lookup') return await favouriteLookupRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/find-me/status') return await findMeStatusRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/find-me/search') return await findMeSearchRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/gallery') return await galleryRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/live/config') return await liveConfigRoute(request,env)
    const galleryDetail = pathname.match(/^\/api\/gallery\/([0-9a-f-]{36})$/i)
    if (request.method === 'GET' && galleryDetail) return await galleryDetailRoute(request,env,galleryDetail[1])
    const galleryDownload = pathname.match(/^\/api\/gallery\/([0-9a-f-]{36})\/download$/i)
    if (request.method === 'GET' && galleryDownload) return await galleryDownloadRoute(request,env,galleryDownload[1])

    if (request.method === 'POST' && pathname === '/api/uploads/prepare') return await prepareUploadsRoute(request,env)
    const uploadComplete = pathname.match(/^\/api\/uploads\/([0-9a-f-]{36})\/complete$/i)
    if (request.method === 'POST' && uploadComplete) {
      const response = await completeUploadRoute(request,env,uploadComplete[1])
      ctx?.waitUntil(dispatchPendingAiJobs(env, 10).catch(() => undefined))
      return response
    }
    const uploadRefresh = pathname.match(/^\/api\/uploads\/([0-9a-f-]{36})\/refresh$/i)
    if (request.method === 'POST' && uploadRefresh) return await refreshUploadRoute(request,env,uploadRefresh[1])

    if (request.method === 'POST' && pathname === '/api/admin/login') return await adminLoginRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/admin/logout') return await adminLogoutRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/admin/session') return await adminSessionRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/admin/stats') return await adminStatsRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/admin/media') return await adminMediaRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/admin/ai/stats') return await adminAiStatsRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/admin/ai/jobs') return await adminAiJobsRoute(request,env)
    if (request.method === 'GET' && pathname === '/api/admin/archive') return await adminArchivesRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/admin/archive') return await adminCreateArchiveRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/admin/ai/backfill') {
      const response = await adminAiBackfillRoute(request,env)
      ctx?.waitUntil(dispatchPendingAiJobs(env, 50).catch(() => undefined))
      return response
    }
    if (request.method === 'GET' && pathname === '/api/admin/ai/face-calibrations') return await adminFaceCalibrationsRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/admin/ai/face-calibrations') return await adminSaveFaceCalibrationRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/admin/ai/face-calibrations/compare') return await adminCompareFaceCalibrationRoute(request,env)
    if (request.method === 'POST' && pathname === '/api/admin/ai/purge-faces') {
      const response = await adminPurgeFacesRoute(request,env)
      ctx?.waitUntil(dispatchPendingAiJobs(env, 10).catch(() => undefined))
      return response
    }
    const adminAiJobAction = pathname.match(/^\/api\/admin\/ai\/jobs\/([^/]+)\/(retry|dismiss)$/)
    if (request.method === 'POST' && adminAiJobAction) {
      const response = await adminAiJobActionRoute(request,env,decodeURIComponent(adminAiJobAction[1]),adminAiJobAction[2] as 'retry' | 'dismiss')
      ctx?.waitUntil(dispatchPendingAiJobs(env, 10).catch(() => undefined))
      return response
    }
    const adminArchiveDetail = pathname.match(/^\/api\/admin\/archive\/([0-9a-f-]{36})$/i)
    if (request.method === 'GET' && adminArchiveDetail) return await adminArchiveDetailRoute(request,env,adminArchiveDetail[1])
    const adminArchiveCancel = pathname.match(/^\/api\/admin\/archive\/([0-9a-f-]{36})\/cancel$/i)
    if (request.method === 'POST' && adminArchiveCancel) return await adminCancelArchiveRoute(request,env,adminArchiveCancel[1])
    const adminArchiveDownload = pathname.match(/^\/api\/admin\/archive\/([0-9a-f-]{36})\/download$/i)
    if (request.method === 'POST' && adminArchiveDownload) return await adminArchiveDownloadRoute(request,env,adminArchiveDownload[1])
    if (request.method === 'PATCH' && pathname === '/api/admin/media/batch') {
      const response = await adminBatchMediaRoute(request,env)
      ctx?.waitUntil(dispatchPendingAiJobs(env, 50).catch(() => undefined))
      return response
    }
    const adminMedia = pathname.match(/^\/api\/admin\/media\/([0-9a-f-]{36})$/i)
    if (request.method === 'DELETE' && adminMedia) {
      const response = await adminDeleteMediaRoute(request,env,adminMedia[1])
      ctx?.waitUntil(dispatchPendingAiJobs(env, 10).catch(() => undefined))
      return response
    }
    const adminFaceToggle = pathname.match(/^\/api\/admin\/media\/([0-9a-f-]{36})\/face-search$/i)
    if (request.method === 'PATCH' && adminFaceToggle) {
      const response = await adminFaceToggleRoute(request,env,adminFaceToggle[1])
      ctx?.waitUntil(dispatchPendingAiJobs(env, 10).catch(() => undefined))
      return response
    }
    const adminCategoryOverride = pathname.match(/^\/api\/admin\/media\/([0-9a-f-]{36})\/categories$/i)
    if (request.method === 'POST' && adminCategoryOverride) return await adminCategoryOverrideRoute(request,env,adminCategoryOverride[1])
    if (request.method === 'GET' && pathname === '/api/admin/settings') return await adminSettingsRoute(request,env)
    if (request.method === 'PATCH' && pathname === '/api/admin/settings') return await adminUpdateSettingsRoute(request,env)

    const builderJob = pathname.match(/^\/api\/archive-builder\/jobs\/([0-9a-f-]{36})$/i)
    if (request.method === 'GET' && builderJob) return await builderArchiveJobRoute(request,env,builderJob[1])
    const builderClaim = pathname.match(/^\/api\/archive-builder\/jobs\/([0-9a-f-]{36})\/claim$/i)
    if (request.method === 'POST' && builderClaim) return await builderClaimArchiveRoute(request,env,builderClaim[1])
    const builderItems = pathname.match(/^\/api\/archive-builder\/jobs\/([0-9a-f-]{36})\/items$/i)
    if (request.method === 'GET' && builderItems) return await builderArchiveItemsRoute(request,env,builderItems[1])
    const builderPlan = pathname.match(/^\/api\/archive-builder\/jobs\/([0-9a-f-]{36})\/plan$/i)
    if (request.method === 'POST' && builderPlan) return await builderArchivePlanRoute(request,env,builderPlan[1])
    const builderProgress = pathname.match(/^\/api\/archive-builder\/jobs\/([0-9a-f-]{36})\/progress$/i)
    if (request.method === 'PATCH' && builderProgress) return await builderArchiveProgressRoute(request,env,builderProgress[1])
    const builderChecksums = pathname.match(/^\/api\/archive-builder\/jobs\/([0-9a-f-]{36})\/checksums$/i)
    if (request.method === 'POST' && builderChecksums) return await builderArchiveChecksumsRoute(request,env,builderChecksums[1])
    const builderPart = pathname.match(/^\/api\/archive-builder\/jobs\/([0-9a-f-]{36})\/parts$/i)
    if (request.method === 'POST' && builderPart) return await builderArchivePartRoute(request,env,builderPart[1])
    const builderArtifacts = pathname.match(/^\/api\/archive-builder\/jobs\/([0-9a-f-]{36})\/artifacts$/i)
    if (request.method === 'POST' && builderArtifacts) return await builderArchiveArtifactsRoute(request,env,builderArtifacts[1])
    const builderComplete = pathname.match(/^\/api\/archive-builder\/jobs\/([0-9a-f-]{36})\/complete$/i)
    if (request.method === 'POST' && builderComplete) return await builderCompleteArchiveRoute(request,env,builderComplete[1])

    throw new HttpError(404,'NOT_FOUND','This API route does not exist.')
  } catch (error) {
    return errorResponse(request,env,error)
  }
}

export default {
  fetch: fetchHandler,
  async queue(batch: MessageBatch<AiQueueMessage>, env: Env) {
    assertSafeConfiguration(env)
    await consumeAiQueue(env, batch)
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    assertSafeConfiguration(env)
    await cleanupStaleUploads(env)
    await dispatchPendingAiJobs(env, 50)
  },
} satisfies ExportedHandler<Env, AiQueueMessage>
