export type Locale = 'en' | 'ms'
export type EventSlug = 'solemnisation' | 'reception'
export type MediaType = 'photo' | 'video'
export type MediaStatus = 'uploading' | 'reconciling' | 'pending' | 'approved' | 'rejected' | 'deleting' | 'deleted' | 'expired'
export type DerivativeStatus = 'pending' | 'ready' | 'partial' | 'unavailable' | 'not_required'

export type ApiError = {
  code: string
  message: string
  retryable?: boolean
  details?: Record<string, unknown>
}

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export type GalleryEvent = {
  id: string
  slug: EventSlug
  name: string
  eventDate: string
  displayName: string
  uploadEnabled: boolean
}

export type GalleryMedia = {
  id: string
  event: GalleryEvent
  mediaType: MediaType
  mimeType: string
  thumbnailUrl: string
  displayUrl: string
  width: number | null
  height: number | null
  durationSeconds: number | null
  guestName: string | null
  guestMessage: string | null
  createdAt: string
}

export type GalleryPage = {
  items: GalleryMedia[]
  nextCursor: string | null
}

export type GalleryDownloadStatus = {
  available: boolean
  availableAt: string
  serverTime: string
}

export type GalleryDownloadResponse = {
  url: string
  expiresInSeconds: number
}

export type UploadVariantIntent = {
  kind: 'display' | 'thumbnail'
  size: number
  mimeType: 'image/webp'
  width: number
  height: number
}

export type UploadFileIntent = {
  clientId: string
  filename: string
  mimeType: string
  size: number
  mediaType: MediaType
  fingerprint: string
  width?: number
  height?: number
  durationSeconds?: number
  variants: UploadVariantIntent[]
}

export type PrepareUploadRequest = {
  requestId: string
  eventSlug: EventSlug
  guestName?: string
  guestMessage?: string
  turnstileToken: string
  files: UploadFileIntent[]
}

export type SignedUploadTarget = {
  url: string
  requiredHeaders: Record<string, string>
  expiresAt: string
}

export type PreparedUpload = {
  clientId: string
  mediaId: string
  original: SignedUploadTarget
  display?: SignedUploadTarget
  thumbnail?: SignedUploadTarget
}

export type PrepareUploadResponse = { uploads: PreparedUpload[] }

export type CompleteUploadRequest = {
  uploadedVariants: Array<'display' | 'thumbnail'>
  derivativeStatus: DerivativeStatus
}

export type CompleteUploadResponse = {
  mediaId: string
  status: 'pending' | 'approved'
}

export type UploadRefreshResponse = {
  original: SignedUploadTarget
  display?: SignedUploadTarget
  thumbnail?: SignedUploadTarget
}

export type AdminSession = { authenticated: boolean; expiresAt?: string }

export type AdminStats = {
  totalUploads: number
  totalPhotos: number
  totalVideos: number
  uploadsToday: number
  dayOne: number
  dayTwo: number
  approved: number
  pending: number
  rejected: number
  derivativeFailures: number
  storage: {
    totalBytes: number
    originalBytes: number
    displayBytes: number
    thumbnailBytes: number
    photoBytes: number
    videoBytes: number
    referenceTargetBytes: number
    softWarningBytes: number
    hardLimitBytes: number | null
  }
}

export type AdminMedia = {
  id: string
  eventSlug: EventSlug
  eventDisplayName: string
  mediaType: MediaType
  mimeType: string
  originalFilename: string
  guestName: string | null
  guestMessage: string | null
  status: MediaStatus
  derivativeStatus: DerivativeStatus
  sizeBytes: number
  createdAt: string
  thumbnailUrl: string | null
  originalDownloadUrl: string | null
}

export type AdminMediaPage = { items: AdminMedia[]; nextCursor: string | null }

export type GallerySettings = {
  uploadsEnabled: boolean
  autoApproveUploads: boolean
  liveWallSource: 'all' | EventSlug
  events: GalleryEvent[]
}
