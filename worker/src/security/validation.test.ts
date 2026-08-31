import { describe, expect, it } from 'vitest'
import { HttpError } from '../lib/http'
import { validateUploadFile } from './validation'

const base = { clientId: '52d0b802-1bee-48be-bb11-d8a2331f9e09', filename: 'memory.jpg', mimeType: 'image/jpeg', size: 1024, mediaType: 'photo' as const, fingerprint: 'a'.repeat(64), variants: [] }

describe('worker file validation', () => {
  it('rejects an unsupported MIME/extension pair', () => {
    expect(() => validateUploadFile({ ...base, filename: 'memory.gif', mimeType: 'image/gif' })).toThrowError(HttpError)
  })

  it('rejects an image over 25 MB', () => {
    expect(() => validateUploadFile({ ...base, size: 25 * 1024 * 1024 + 1 })).toThrowError(/25 MB/)
  })
})
