import type {
  AdminMediaPage,
  AdminSession,
  AdminStats,
  ApiEnvelope,
  CompleteUploadRequest,
  CompleteUploadResponse,
  EventSlug,
  GalleryEvent,
  GalleryDownloadResponse,
  GalleryDownloadStatus,
  GalleryPage,
  GallerySettings,
  MediaStatus,
  PrepareUploadRequest,
  PrepareUploadResponse,
  UploadRefreshResponse,
} from '../../shared/contracts'
import { API_BASE_URL, USE_MOCK_DATA } from '../config'
import { mockAdminMedia, mockAdminStats, mockEvents, mockGallery, mockSettings } from '../data/mock'

let developmentSettings: GallerySettings = { ...mockSettings, events: mockSettings.events.map((event) => ({ ...event })) }
const developmentSettingsSnapshot = () => ({ ...developmentSettings, events: developmentSettings.events.map((event) => ({ ...event })) })
const mockDownloadsAvailableAt = '2027-08-23T00:00:00+08:00'

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

async function request<T>(path: string, init: RequestInit = {}, retries = 0): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Gallery-Session': browserSessionId(),
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

export async function getGallery(params: { event?: EventSlug; type?: 'photo' | 'video'; cursor?: string; limit?: number } = {}): Promise<GalleryPage> {
  if (USE_MOCK_DATA) {
    const items = mockGallery.filter((item) => (!params.event || item.event.slug === params.event) && (!params.type || item.mediaType === params.type))
    return { items, nextCursor: null }
  }
  const query = new URLSearchParams()
  if (params.event) query.set('event', params.event)
  if (params.type) query.set('type', params.type)
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

export async function getGalleryDownloadStatus(): Promise<GalleryDownloadStatus> {
  if (USE_MOCK_DATA) {
    const serverTime = new Date().toISOString()
    return {
      available: Date.parse(serverTime) >= Date.parse(mockDownloadsAvailableAt),
      availableAt: mockDownloadsAvailableAt,
      serverTime,
    }
  }
  return request('/api/gallery/download-status')
}

export async function getMediaDownload(mediaId: string): Promise<GalleryDownloadResponse> {
  if (USE_MOCK_DATA) {
    const item = mockGallery.find((candidate) => candidate.id === mediaId)
    if (!item) throw new GalleryApiError('This memory could not be found.', 'MEDIA_NOT_FOUND')
    return { url: item.displayUrl, expiresInSeconds: 300 }
  }
  return request(`/api/gallery/${encodeURIComponent(mediaId)}/download`, {}, 1)
}

export async function getLiveConfig(): Promise<{ source: 'all' | EventSlug }> {
  if (USE_MOCK_DATA) return { source: developmentSettings.liveWallSource }
  return request('/api/live/config',{},2)
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

export async function getAdminMedia(params: { status?: MediaStatus; event?: EventSlug; type?: 'photo' | 'video'; cursor?: string } = {}): Promise<AdminMediaPage> {
  if (USE_MOCK_DATA) {
    const items = mockAdminMedia.filter((item) => (!params.status || item.status === params.status) && (!params.event || item.eventSlug === params.event) && (!params.type || item.mediaType === params.type))
    return { items, nextCursor: null }
  }
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])))
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
      events: settings.event
        ? developmentSettings.events.map((event) => event.slug === settings.event!.slug ? { ...event, uploadEnabled: settings.event!.uploadEnabled } : event)
        : developmentSettings.events,
    }
    return developmentSettingsSnapshot()
  }
  return request<GallerySettings>('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
}
