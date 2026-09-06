import type {
  AdminMediaPage,
  AdminSession,
  AdminStats,
  AdminAiStats,
  AiJob,
  ArchiveArtifact,
  ArchiveJob,
  ApiEnvelope,
  CompleteUploadRequest,
  CompleteUploadResponse,
  EventSlug,
  GalleryEvent,
  GalleryCategory,
  GalleryPage,
  GallerySettings,
  ExplorePage,
  ExploreQuery,
  FavouriteLookupResponse,
  FaceCalibration,
  FaceCalibrationComparison,
  FindMeAvailability,
  FindMeResult,
  PublicCapabilities,
  MediaStatus,
  PrepareUploadRequest,
  PrepareUploadResponse,
  UploadRefreshResponse,
} from '../../shared/contracts'
import { API_BASE_URL, USE_MOCK_DATA } from '../config'
import { mockAdminMedia, mockAdminStats, mockEvents, mockGallery, mockSettings } from '../data/mock'

let developmentSettings: GallerySettings = { ...mockSettings, events: mockSettings.events.map((event) => ({ ...event })) }
const developmentSettingsSnapshot = () => ({ ...developmentSettings, events: developmentSettings.events.map((event) => ({ ...event })) })
let developmentArchives: ArchiveJob[] = []
const developmentArchiveSnapshot = (job: ArchiveJob): ArchiveJob => ({
  ...job,
  parts: job.parts.map((part) => ({ ...part })),
  artifacts: job.artifacts.map((artifact) => ({ ...artifact })),
})

export class GalleryApiError extends Error {
  code: string
  retryable: boolean
  details?: Record<string, unknown>

  constructor(message: string, code = 'REQUEST_FAILED', retryable = false, details?: Record<string, unknown>) {
    super(message)
    this.name = 'GalleryApiError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

function browserSessionId() {
  const key = 'an-gallery-session'
  let value = window.localStorage.getItem(key)
  if (!value) {
    value = crypto.randomUUID()
    window.localStorage.setItem(key, value)
  }
  return value
}

async function request<T>(path: string, init: RequestInit = {}, retries = 0, options: { includeSession?: boolean } = {}): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(options.includeSession === false ? {} : { 'X-Gallery-Session': browserSessionId() }),
          ...init.headers,
        },
      })
      const body = await response.json().catch(() => null) as ApiEnvelope<T> | null
      if (!response.ok || !body?.ok) {
        const error = body && !body.ok ? body.error : null
        throw new GalleryApiError(error?.message || 'We lost connection for a moment. Please try again.', error?.code || `HTTP_${response.status}`, error?.retryable ?? response.status >= 500, error?.details)
      }
      return body.data
    } catch (error) {
      const known = error instanceof GalleryApiError ? error : new GalleryApiError('We lost connection for a moment. Please try again.', 'NETWORK_ERROR', true)
      if (attempt >= retries || !known.retryable) throw known
      await new Promise((resolve) => window.setTimeout(resolve, 350 * 2 ** attempt + Math.random() * 150))
      attempt += 1
    }
  }
}

const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

export async function getEvents(): Promise<GalleryEvent[]> {
  if (USE_MOCK_DATA) return mockEvents
  return request('/api/events', {}, 2)
}

export async function getGallery(params: { event?: EventSlug; type?: 'photo' | 'video'; category?: string; source?: 'guest' | 'photographer'; cursor?: string; limit?: number } = {}): Promise<GalleryPage> {
  if (USE_MOCK_DATA) {
    const items = mockGallery.filter((item) => (!params.event || item.event.slug === params.event) && (!params.type || item.mediaType === params.type) &&
      (!params.source || item.source === params.source) && (!params.category || item.categories?.some((category) => category.slug === params.category)))
    return { items, nextCursor: null }
  }
  const query = new URLSearchParams()
  if (params.event) query.set('event', params.event)
  if (params.type) query.set('type', params.type)
  if (params.category) query.set('category', params.category)
  if (params.source) query.set('source', params.source)
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.limit) query.set('limit', String(params.limit))
  return request(`/api/gallery?${query}`, {}, 2)
}

export async function getGalleryMedia(mediaId: string) {
  if (USE_MOCK_DATA) {
    const item = mockGallery.find((candidate) => candidate.id === mediaId)
    if (!item) throw new GalleryApiError('This memory could not be found.', 'MEDIA_NOT_FOUND')
    return item
  }
  return request<GalleryPage['items'][number]>(`/api/gallery/${encodeURIComponent(mediaId)}`, {}, 2)
}

export async function getLiveConfig(): Promise<{ source: 'all' | EventSlug; enabled: boolean }> {
  if (USE_MOCK_DATA) return { source: developmentSettings.liveWallSource, enabled: developmentSettings.eventMode === 'live' }
  return request('/api/live/config',{},2)
}

export async function getCapabilities(): Promise<PublicCapabilities> {
  if (USE_MOCK_DATA) return { eventMode:developmentSettings.eventMode,uploadsEnabled:developmentSettings.uploadsEnabled,liveWallEnabled:developmentSettings.eventMode === 'live',galleryEnabled:true,findMeEnabled:developmentSettings.faceSearchEnabled,semanticSearchEnabled:developmentSettings.semanticSearchEnabled,categoryExploreEnabled:true,archiveAvailable:developmentSettings.eventMode !== 'live' }
  return request('/api/capabilities',{},2,{ includeSession:false })
}

export async function getDiscoveryCategories(): Promise<GalleryCategory[]> {
  if (USE_MOCK_DATA) {
    const values = new Map<string,GalleryCategory>()
    mockGallery.flatMap((item) => item.categories || []).forEach((category) => values.set(category.slug,category))
    return [...values.values()]
  }
  return request('/api/discovery/categories',{},2,{ includeSession:false })
}

export async function searchMemories(payload: ExploreQuery): Promise<ExplorePage> {
  if (USE_MOCK_DATA) {
    const query = payload.query?.toLocaleLowerCase() || ''
    const items = mockGallery.filter((item) => {
      const text = [item.guestMessage,item.aiCaption,...(item.categories || []).map((category) => category.displayName)].filter(Boolean).join(' ').toLocaleLowerCase()
      return text.includes(query.split(/\s+/).find((word) => word.length > 3) || query) && (!payload.event || item.event.slug === payload.event) && (!payload.type || item.mediaType === payload.type) && (!payload.category || item.categories?.some((category) => category.slug === payload.category))
    }).map((item,index) => ({ ...item,similarity:0.93 - index * 0.04 }))
    return { items,nextCursor:null,semanticApplied:true,semanticAvailable:true }
  }
  return request('/api/discovery/search',json(payload),1,{ includeSession:false })
}

export async function lookupFavouriteMemories(ids: string[]): Promise<FavouriteLookupResponse> {
  if (USE_MOCK_DATA) {
    const items = ids.map((id) => mockGallery.find((item) => item.id === id)).filter((item): item is GalleryPage['items'][number] => Boolean(item))
    return { items,missingIds:ids.filter((id) => !items.some((item) => item.id === id)) }
  }
  return request('/api/gallery/lookup',json({ ids }),1)
}

export async function getMediaDownload(id: string): Promise<{ url: string; expiresInSeconds: number }> {
  if (USE_MOCK_DATA) {
    const item = mockGallery.find((candidate) => candidate.id === id)
    if (!item) throw new GalleryApiError('This memory could not be found.','MEDIA_NOT_FOUND')
    return { url:item.displayUrl,expiresInSeconds:300 }
  }
  return request(`/api/gallery/${encodeURIComponent(id)}/download`,{},1,{ includeSession:false })
}

export async function getFindMeAvailability(): Promise<FindMeAvailability> {
  if (USE_MOCK_DATA) return { available:true,provider:'mock',modelVersion:'mock-v1',maxImageBytes:6 * 1024 ** 2,sessionTtlSeconds:600 }
  return request('/api/find-me/status',{},1,{ includeSession:false })
}

export async function findMyMemories(image: Blob, signal?: AbortSignal): Promise<FindMeResult> {
  if (USE_MOCK_DATA) {
    await new Promise<void>((resolve,reject) => { const timer=window.setTimeout(resolve,650); signal?.addEventListener('abort',() => { window.clearTimeout(timer); reject(new DOMException('Aborted','AbortError')) },{ once:true }) })
    const matches = mockGallery.filter((item) => item.mediaType === 'photo').slice(0,6)
    return { searchSessionId:crypto.randomUUID(),expiresAt:new Date(Date.now()+600_000).toISOString(),strongMatches:matches.slice(0,3).map((item,index) => ({ ...item,similarity:.91-index*.04,matchStrength:'strong' })),possibleMatches:matches.slice(3).map((item,index) => ({ ...item,similarity:.69-index*.04,matchStrength:'possible' })),totalMatches:matches.length }
  }
  return request('/api/find-me/search',{ method:'POST',body:image,signal,headers:{'Content-Type':image.type || 'image/jpeg','X-Find-Me-Consent':'true'} },0,{ includeSession:false })
}

export async function prepareUploads(payload: PrepareUploadRequest): Promise<PrepareUploadResponse> {
  if (USE_MOCK_DATA) {
    return {
      uploads: payload.files.map((file) => {
        const target = { url: 'mock://upload', requiredHeaders: {}, expiresAt: new Date(Date.now() + 600_000).toISOString() }
        return { clientId: file.clientId, mediaId: crypto.randomUUID(), original: target, display: file.variants.some((variant) => variant.kind === 'display') ? target : undefined, thumbnail: file.variants.some((variant) => variant.kind === 'thumbnail') ? target : undefined }
      }),
    }
  }
  return request('/api/uploads/prepare', json(payload), 1)
}

export async function completeUpload(mediaId: string, payload: CompleteUploadRequest): Promise<CompleteUploadResponse> {
  if (USE_MOCK_DATA) return { mediaId, status: 'pending' }
  return request(`/api/uploads/${encodeURIComponent(mediaId)}/complete`, json(payload), 2)
}

export async function refreshUpload(mediaId: string): Promise<UploadRefreshResponse> {
  return request(`/api/uploads/${encodeURIComponent(mediaId)}/refresh`, json({}), 1)
}

export async function adminLogin(password: string): Promise<AdminSession> {
  if (USE_MOCK_DATA) return { authenticated: true, expiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString() }
  return request('/api/admin/login', json({ password }))
}

export async function adminLogout() {
  if (USE_MOCK_DATA) return { authenticated: false }
  return request<AdminSession>('/api/admin/logout', json({}))
}

export async function getAdminSession(): Promise<AdminSession> {
  if (USE_MOCK_DATA) return { authenticated: true, expiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString() }
  return request('/api/admin/session')
}

export async function getAdminStats(): Promise<AdminStats> {
  if (USE_MOCK_DATA) return mockAdminStats
  return request('/api/admin/stats')
}

export async function getAdminMedia(params: { status?: MediaStatus; event?: EventSlug; type?: 'photo' | 'video'; category?: string; minConfidence?: number; cursor?: string } = {}): Promise<AdminMediaPage> {
  if (USE_MOCK_DATA) {
    const items = mockAdminMedia.filter((item) => (!params.status || item.status === params.status) && (!params.event || item.eventSlug === params.event) && (!params.type || item.mediaType === params.type))
    return { items, nextCursor: null }
  }
  const query = new URLSearchParams(Object.entries(params).filter(([,value]) => value !== undefined && value !== '').map(([key,value]) => [key,String(value)]))
  return request(`/api/admin/media?${query}`)
}

export async function updateAdminMedia(ids: string[], status: 'approved' | 'rejected') {
  if (USE_MOCK_DATA) return { updated: ids.length }
  return request<{ updated: number }>('/api/admin/media/batch', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, status }) })
}

export async function deleteAdminMedia(id: string) {
  if (USE_MOCK_DATA) return { deleted: true }
  return request<{ deleted: boolean }>(`/api/admin/media/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function getAdminSettings(): Promise<GallerySettings> {
  if (USE_MOCK_DATA) return developmentSettingsSnapshot()
  return request('/api/admin/settings')
}

export async function updateAdminSettings(settings: Partial<Omit<GallerySettings, 'events'>> & { event?: { slug: EventSlug; uploadEnabled: boolean } }) {
  if (USE_MOCK_DATA) {
    developmentSettings = {
      ...developmentSettings,
      ...(typeof settings.uploadsEnabled === 'boolean' ? { uploadsEnabled: settings.uploadsEnabled } : {}),
      ...(typeof settings.autoApproveUploads === 'boolean' ? { autoApproveUploads: settings.autoApproveUploads } : {}),
      ...(settings.liveWallSource ? { liveWallSource: settings.liveWallSource } : {}),
      ...(settings.eventMode ? { eventMode: settings.eventMode } : {}),
      ...(typeof settings.aiEnabled === 'boolean' ? { aiEnabled:settings.aiEnabled } : {}),
      ...(typeof settings.faceSearchEnabled === 'boolean' ? { faceSearchEnabled:settings.faceSearchEnabled } : {}),
      ...(typeof settings.autoAiProcessing === 'boolean' ? { autoAiProcessing:settings.autoAiProcessing } : {}),
      ...(typeof settings.semanticSearchEnabled === 'boolean' ? { semanticSearchEnabled:settings.semanticSearchEnabled } : {}),
      ...(typeof settings.aiProcessingPaused === 'boolean' ? { aiProcessingPaused:settings.aiProcessingPaused } : {}),
      events: settings.event
        ? developmentSettings.events.map((event) => event.slug === settings.event!.slug ? { ...event, uploadEnabled: settings.event!.uploadEnabled } : event)
        : developmentSettings.events,
    }
    return developmentSettingsSnapshot()
  }
  return request<GallerySettings>('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
}

export async function getAdminAiStats(): Promise<AdminAiStats> {
  if (USE_MOCK_DATA) return { totalEligible:148,indexed:121,queued:12,processing:3,failed:2,notProcessed:27,categorised:119,faceIndexedPhotos:108,detectedFaces:327,semanticIndexed:116,paused:false,faceSearchAvailable:true }
  return request('/api/admin/ai/stats')
}

export async function getAdminAiJobs(status?: AiJob['status']): Promise<{ jobs: AiJob[] }> {
  if (USE_MOCK_DATA) return { jobs:[] }
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return request(`/api/admin/ai/jobs${query}`)
}

export async function backfillAdminAi(mode: 'unprocessed' | 'failed' | 'all' | 'selected', mediaIds?: string[]) {
  if (USE_MOCK_DATA) return { queued:mode === 'selected' ? mediaIds?.length || 0 : 27,runId:crypto.randomUUID(),truncated:false }
  return request<{ queued:number;runId:string;truncated:boolean }>('/api/admin/ai/backfill',json({ mode,mediaIds }))
}

export async function updateAdminAiJob(jobId: string, action: 'retry' | 'dismiss') {
  if (USE_MOCK_DATA) return { updated:true }
  return request<{ updated:boolean }>(`/api/admin/ai/jobs/${encodeURIComponent(jobId)}/${action}`,json({}))
}

export async function setAdminMediaFaceSearch(mediaId: string, enabled: boolean) {
  if (USE_MOCK_DATA) return { faceSearchEnabled:enabled }
  return request<{ faceSearchEnabled:boolean }>(`/api/admin/media/${encodeURIComponent(mediaId)}/face-search`,{ method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ enabled }) })
}

export async function updateAdminMediaCategory(mediaId: string, action: 'add' | 'remove' | 'suppress' | 'restore', categorySlug: string) {
  if (USE_MOCK_DATA) return { updated:true }
  return request<{ updated:boolean }>(`/api/admin/media/${encodeURIComponent(mediaId)}/categories`,json({ action,categorySlug }))
}

export async function getFaceCalibrations(): Promise<{ calibrations: FaceCalibration[] }> {
  if (USE_MOCK_DATA) return { calibrations:[{ id:'mock',provider:'mock',model:'deterministic-development-face',modelVersion:'mock-v1',dimensions:16,metric:'cosine',matchThreshold:.35,strongMatchThreshold:.72,notes:'Development only',active:true,updatedAt:new Date().toISOString() }] }
  return request('/api/admin/ai/face-calibrations')
}

export async function saveFaceCalibration(payload: { matchThreshold:number;strongMatchThreshold:number;notes?:string;confirmation:string }) {
  if (USE_MOCK_DATA) {
    const { calibrations } = await getFaceCalibrations()
    return { calibration:{ ...calibrations[0],matchThreshold:payload.matchThreshold,strongMatchThreshold:payload.strongMatchThreshold,notes:payload.notes || null,updatedAt:new Date().toISOString() } }
  }
  return request<{ calibration:FaceCalibration }>('/api/admin/ai/face-calibrations',json(payload))
}

export async function compareFaceCalibration(left: File, right: File): Promise<FaceCalibrationComparison> {
  if (USE_MOCK_DATA) return { provider:'mock',model:'deterministic-development-face',modelVersion:'mock-v1',dimensions:16,metric:'cosine',cosineSimilarity:.86,dotProduct:3.42,euclideanDistance:.51,leftQuality:.92,rightQuality:.89 }
  const body = new FormData()
  body.set('left',left)
  body.set('right',right)
  return request('/api/admin/ai/face-calibrations/compare',{ method:'POST',body },0)
}

export async function purgeFaceIndex(confirmation: string) {
  if (USE_MOCK_DATA) return { jobId:crypto.randomUUID() }
  return request<{ jobId:string }>('/api/admin/ai/purge-faces',json({ confirmation }))
}

export async function getAdminArchives(): Promise<{ jobs: ArchiveJob[] }> {
  if (USE_MOCK_DATA) return { jobs:developmentArchives.map(developmentArchiveSnapshot) }
  return request('/api/admin/archive')
}

export async function createAdminArchive(payload: { scope:'all'|'event';eventSlug?:EventSlug;shardSizeBytes?:number }): Promise<ArchiveJob> {
  if (USE_MOCK_DATA) {
    const job: ArchiveJob = { id:crypto.randomUUID(),status:'inventory',scope:payload.scope,eventId:payload.scope === 'event' ? mockEvents.find((event) => event.slug === payload.eventSlug)?.id || null : null,shardSizeBytes:payload.shardSizeBytes || 5 * 1024 ** 3,totalFiles:148,totalBytes:83.4 * 1024 ** 3,processedFiles:0,processedBytes:0,errorMessage:null,createdAt:new Date().toISOString(),startedAt:null,completedAt:null,parts:[],artifacts:[] }
    developmentArchives = [job,...developmentArchives]
    return developmentArchiveSnapshot(job)
  }
  return request('/api/admin/archive',json(payload))
}

export async function cancelAdminArchive(jobId: string, confirmation: string) {
  if (USE_MOCK_DATA) {
    if (confirmation !== `CANCEL ${jobId}`) throw new GalleryApiError('Enter the exact archive cancellation confirmation.','CONFIRMATION_REQUIRED')
    developmentArchives = developmentArchives.map((job) => job.id === jobId ? { ...job,status:'cancelled',errorMessage:'Cancelled by administrator.' } : job)
    return { cancelled:true }
  }
  return request<{ cancelled:boolean }>(`/api/admin/archive/${encodeURIComponent(jobId)}/cancel`,json({ confirmation }))
}

export async function getAdminArchiveDownload(jobId: string, target: { partId?:string;artifactKind?:ArchiveArtifact['kind'] }) {
  if (USE_MOCK_DATA) return { url:'#',expiresInSeconds:600 }
  return request<{ url:string;expiresInSeconds:number }>(`/api/admin/archive/${encodeURIComponent(jobId)}/download`,json(target))
}
