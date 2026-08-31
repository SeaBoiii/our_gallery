import { describe, expect, it } from 'vitest'
import { getUploadMimeType, validateFile } from './files'

describe('browser file type normalization', () => {
  it('accepts an HEIC camera file when the browser omits File.type', () => {
    const file = new File(['heic'], 'IMG_2108.HEIC', { type: '' })

    expect(getUploadMimeType(file)).toBe('image/heic')
    expect(validateFile(file)).toEqual({ valid: true, mediaType: 'photo' })
  })

  it('does not infer a MIME type for an unsupported extension', () => {
    const file = new File(['unknown'], 'memory.bin', { type: '' })

    expect(getUploadMimeType(file)).toBe('')
    expect(validateFile(file).valid).toBe(false)
  })
})
