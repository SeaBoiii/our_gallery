import type { CompleteUploadRequest, SignedUploadTarget } from '../../shared/contracts'
import { USE_MOCK_DATA } from '../config'
import type { UploadQueueItem } from '../types/upload'
import { completeUpload, refreshUpload } from './api'

export type UploadTransferErrorCode = 'NETWORK_INTERRUPTED' | 'UPLOAD_STALLED' | 'UPLOAD_CANCELLED' | 'UPLOAD_REJECTED'

export class UploadTransferError extends Error {
  code: UploadTransferErrorCode
  status?: number

  constructor(code: UploadTransferErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'UploadTransferError'
    this.code = code
    this.status = status
  }
}

const STALL_TIMEOUT_MS = 45_000

export function derivativeCompletionStatus(
  mediaType: UploadQueueItem['mediaType'],
  expected: Array<'display' | 'thumbnail'>,
  uploaded: Array<'display' | 'thumbnail'>,
): CompleteUploadRequest['derivativeStatus'] {
  if (expected.length === 0) return mediaType === 'video' ? 'not_required' : 'unavailable'
  if (uploaded.length === expected.length) return 'ready'
  return uploaded.length ? 'partial' : 'unavailable'
}

function uploadBlob(target: SignedUploadTarget, blob: Blob, onProgress: (loaded: number) => void) {
  if (USE_MOCK_DATA || target.url.startsWith('mock://')) {
    return new Promise<void>((resolve) => {
      let loaded = 0
      const tick = () => {
        loaded = Math.min(blob.size, loaded + Math.max(1, blob.size / 12))
        onProgress(loaded)
        if (loaded >= blob.size) resolve()
        else window.setTimeout(tick, 55)
      }
      tick()
    })
  }
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let stalled = false
    let watchdog = 0
    const clearWatchdog = () => window.clearTimeout(watchdog)
    const armWatchdog = () => {
      clearWatchdog()
      watchdog = window.setTimeout(() => {
        stalled = true
        xhr.abort()
      }, STALL_TIMEOUT_MS)
    }
    xhr.open('PUT', target.url)
    for (const [key, value] of Object.entries(target.requiredHeaders)) xhr.setRequestHeader(key, value)
    xhr.upload.onprogress = (event) => { armWatchdog(); onProgress(event.loaded) }
    xhr.onerror = () => { clearWatchdog(); reject(new UploadTransferError('NETWORK_INTERRUPTED', 'Network interruption')) }
    xhr.onabort = () => { clearWatchdog(); reject(new UploadTransferError(stalled ? 'UPLOAD_STALLED' : 'UPLOAD_CANCELLED', stalled ? 'Upload stalled' : 'Upload cancelled')) }
    xhr.onload = () => {
      clearWatchdog()
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 412) resolve()
      else reject(new UploadTransferError('UPLOAD_REJECTED', 'Upload URL rejected', xhr.status))
    }
    armWatchdog()
    xhr.send(blob)
  })
}

async function uploadSet(item: UploadQueueItem, targets: { original: SignedUploadTarget; display?: SignedUploadTarget; thumbnail?: SignedUploadTarget }, onProgress: (progress: number) => void) {
  const parts: Array<{ key: string; blob: Blob; target: SignedUploadTarget }> = [
    { key: 'original', blob: item.file, target: targets.original },
  ]
  for (const derivative of item.derivatives) {
    const target = targets[derivative.kind]
    if (target) parts.push({ key: derivative.kind, blob: derivative.blob, target })
  }
  const total = parts.reduce((sum, part) => sum + part.blob.size, 0)
  let completed = 0
  const uploadedVariants: Array<'display' | 'thumbnail'> = []

  await uploadBlob(parts[0].target, parts[0].blob, (loaded) => onProgress(Math.round(((completed + loaded) / total) * 100)))
  completed += parts[0].blob.size

  for (const part of parts.slice(1)) {
    try {
      await uploadBlob(part.target, part.blob, (loaded) => onProgress(Math.round(((completed + loaded) / total) * 100)))
      uploadedVariants.push(part.key as 'display' | 'thumbnail')
    } catch {
      // The untouched original remains valid even when a browser derivative fails.
    }
    completed += part.blob.size
  }
  onProgress(100)
  return uploadedVariants
}

export async function uploadQueueItem(item: UploadQueueItem, onProgress: (progress: number) => void, options: { refreshBeforeUpload?: boolean } = {}) {
  if (!item.prepared) throw new Error('Upload was not prepared')
  let targets = item.prepared
  const expiresSoon = Date.parse(targets.original.expiresAt) < Date.now() + 30_000
  if (!USE_MOCK_DATA && (options.refreshBeforeUpload || expiresSoon)) {
    const refreshed = await refreshUpload(item.prepared.mediaId)
    targets = { ...item.prepared, ...refreshed }
  }
  // A failed direct PUT is surfaced to the guest. Retrying a large video is
  // always an explicit action, never an automatic hidden retransmission.
  const uploadedVariants = await uploadSet(item, targets, onProgress)
  const expected = item.derivatives.map((derivative) => derivative.kind)
  const derivativeStatus = derivativeCompletionStatus(item.mediaType, expected, uploadedVariants)
  return completeUpload(item.prepared.mediaId, { uploadedVariants, derivativeStatus })
}
