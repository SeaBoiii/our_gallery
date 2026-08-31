import { describe, expect, it, vi } from 'vitest'
import type { UploadQueueItem } from '../types/upload'
import { derivativeCompletionStatus, uploadQueueItem } from './upload'

const apiMocks = vi.hoisted(() => ({
  completeUpload: vi.fn(async (mediaId: string) => ({ mediaId, status: 'pending' as const })),
  refreshUpload: vi.fn(),
}))

vi.mock('./api', () => apiMocks)

describe('upload pipeline', () => {
  it('completes an original upload and reports progress', async () => {
    const target = { url: 'mock://upload', requiredHeaders: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() }
    const mediaId = crypto.randomUUID()
    const item: UploadQueueItem = {
      clientId: crypto.randomUUID(),
      file: new File(['guest memory'], 'memory.jpg', { type: 'image/jpeg' }),
      mediaType: 'photo', previewUrl: '', derivatives: [], derivativeStatus: 'unavailable', state: 'queued', progress: 0,
      prepared: { clientId: 'client', mediaId, original: target },
    }
    const progress: number[] = []
    const result = await uploadQueueItem(item, (value) => progress.push(value))
    expect(result.status).toBe('pending')
    expect(progress.at(-1)).toBe(100)
    expect(apiMocks.completeUpload).toHaveBeenCalledWith(mediaId, {
      uploadedVariants: [],
      derivativeStatus: 'unavailable',
    })
  })

  it('keeps a successful original when only one derivative succeeds', () => {
    expect(derivativeCompletionStatus('photo', ['display','thumbnail'], ['thumbnail'])).toBe('partial')
  })
})
