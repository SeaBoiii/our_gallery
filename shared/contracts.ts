export type Locale = 'en' | 'ms'
export type EventSlug = 'solemnisation' | 'reception'
export type MediaType = 'photo' | 'video'
export type MediaStatus = 'uploading' | 'reconciling' | 'pending' | 'approved' | 'rejected' | 'deleting' | 'deleted' | 'expired'
export type DerivativeStatus = 'pending' | 'ready' | 'partial' | 'unavailable' | 'not_required'
export type EventMode = 'live' | 'post-wedding' | 'archive'
export type AiTaskStatus = 'not_requested' | 'queued' | 'processing' | 'complete' | 'partial' | 'failed' | 'disabled'
export type AiJobStatus = 'queued' | 'dispatched' | 'processing' | 'complete' | 'partial' | 'failed' | 'dismissed' | 'cancelled'
export type ArchiveJobStatus = 'draft' | 'inventory' | 'building' | 'partial' | 'complete' | 'failed' | 'cancelled'

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
  altText?: string
  aiCaption?: string | null
  categories?: GalleryCategory[]
  source?: 'guest' | 'photographer'
  similarity?: number
  matchStrength?: 'strong' | 'possible'
  createdAt: string
}

export type GalleryPage = {
  items: GalleryMedia[]
  nextCursor: string | null
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
  faceSearchEnabled?: boolean
  ai?: MediaAiSummary | null
  categories?: GalleryCategory[]
}

export type AdminMediaPage = { items: AdminMedia[]; nextCursor: string | null }

export type GallerySettings = {
  uploadsEnabled: boolean
  autoApproveUploads: boolean
  liveWallSource: 'all' | EventSlug
  eventMode: EventMode
  aiEnabled: boolean
  faceSearchEnabled: boolean
  autoAiProcessing: boolean
  semanticSearchEnabled: boolean
  aiProcessingPaused: boolean
  events: GalleryEvent[]
}

export type PublicCapabilities = {
  eventMode: EventMode
  uploadsEnabled: boolean
  liveWallEnabled: boolean
  galleryEnabled: true
  findMeEnabled: boolean
  semanticSearchEnabled: boolean
  categoryExploreEnabled: boolean
  archiveAvailable: boolean
}

export type GalleryCategory = {
  id: string
  slug: string
  displayName: string
  confidence?: number | null
  source?: 'ai' | 'admin'
}

export type MediaAiSummary = {
  overallStatus: AiTaskStatus
  categorisationStatus: AiTaskStatus
  captionStatus: AiTaskStatus
  faceIndexStatus: AiTaskStatus
  semanticIndexStatus: AiTaskStatus
  caption: string | null
  scene: string | null
  lastErrorCode: string | null
  updatedAt: string | null
}

export type ExploreQuery = {
  query?: string
  event?: EventSlug
  category?: string
  type?: MediaType
  source?: 'guest' | 'photographer'
  cursor?: string
  limit?: number
}

export type ExplorePage = GalleryPage & {
  semanticApplied: boolean
  semanticAvailable: boolean
}

export type FavouriteLookupResponse = {
  items: GalleryMedia[]
  missingIds: string[]
}

export type FindMeAvailability = {
  available: boolean
  reason?: 'disabled' | 'provider_unavailable' | 'calibration_required' | 'index_unavailable'
  provider?: string
  modelVersion?: string
  maxImageBytes: number
  sessionTtlSeconds: number
}

export type FindMeResult = {
  searchSessionId: string
  expiresAt: string
  strongMatches: GalleryMedia[]
  possibleMatches: GalleryMedia[]
  totalMatches: number
}

export type AiJob = {
  id: string
  type: 'ANALYSE_MEDIA' | 'REPROCESS_MEDIA' | 'DELETE_MEDIA_AI' | 'PURGE_MEDIA_FACES' | 'PURGE_ALL_FACES'
  mediaId: string | null
  status: AiJobStatus
  attemptCount: number
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
}

export type AdminAiStats = {
  totalEligible: number
  indexed: number
  queued: number
  processing: number
  failed: number
  notProcessed: number
  categorised: number
  faceIndexedPhotos: number
  detectedFaces: number
  semanticIndexed: number
  paused: boolean
  faceSearchAvailable: boolean
}

export type FaceCalibration = {
  id: string
  provider: string
  model: string
  modelVersion: string
  dimensions: number
  metric: 'cosine' | 'euclidean' | 'dot-product'
  matchThreshold: number
  strongMatchThreshold: number
  notes: string | null
  active: boolean
  updatedAt: string
}

export type FaceCalibrationComparison = {
  provider: string
  model: string
  modelVersion: string
  dimensions: number
  metric: 'cosine' | 'euclidean' | 'dot-product'
  cosineSimilarity: number
  dotProduct: number
  euclideanDistance: number
  leftQuality: number | null
  rightQuality: number | null
}

export type ArchivePart = {
  id: string
  eventId: string
  eventDisplayName: string
  partNumber: number
  filename: string
  sizeBytes: number
  sha256: string
  fileCount: number
  status: 'building' | 'complete' | 'failed'
  planSha256?: string | null
}

export type ArchiveArtifact = {
  id: string
  kind: 'manifest_json' | 'manifest_csv' | 'checksums' | 'readme'
  filename: string
  sizeBytes: number
  sha256: string
}

export type ArchiveJob = {
  id: string
  status: ArchiveJobStatus
  scope: 'all' | 'event'
  eventId: string | null
  shardSizeBytes: number
  totalFiles: number
  totalBytes: number
  processedFiles: number
  processedBytes: number
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  parts: ArchivePart[]
  artifacts: ArchiveArtifact[]
}
