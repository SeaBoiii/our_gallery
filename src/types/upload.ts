import type { DerivativeStatus, EventSlug, MediaType, PreparedUpload } from '../../shared/contracts'
import type { PreparedDerivative } from '../utils/files'

export type UploadState = 'queued' | 'preparing' | 'uploading' | 'completing' | 'complete' | 'failed'

export type UploadQueueItem = {
  clientId: string
  file: File
  mediaType: MediaType
  previewUrl: string
  fingerprint?: string
  derivatives: PreparedDerivative[]
  derivativeStatus: DerivativeStatus
  prepared?: PreparedUpload
  state: UploadState
  progress: number
  error?: string
}

export type UploadBatchDetails = {
  eventSlug: EventSlug
  guestName: string
  guestMessage: string
}
