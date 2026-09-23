import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeEnv } from '../../test/fake'
import { copyObject, signedDownload, signedPut } from './signing'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('R2 signing', () => {
  it('caps a new PUT signature at the original authorization deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2027-08-21T12:00:00.500Z')
    const deadline = '2027-08-21T12:00:20.000Z'
    const target = await signedPut(fakeEnv(), 'staging/memory.jpg', 'image/jpeg', 600, deadline)
    const url = new URL(target.url)
    expect(url.searchParams.get('X-Amz-Date')).toBe('20270821T120000Z')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('19')
    expect(Date.parse(target.expiresAt)).toBeLessThanOrEqual(Date.parse(deadline))
    vi.setSystemTime(deadline)
    await expect(signedPut(fakeEnv(), 'staging/memory.jpg', 'image/jpeg', 20, deadline))
      .rejects.toMatchObject({ status: 409, code: 'UPLOAD_AUTHORIZATION_EXPIRED' })
  })

  it('binds the upload content type and overwrite guard into the signature', async () => {
    const target = await signedPut(fakeEnv(), 'staging/2027-08-21/memory.webp', 'image/webp', 120)
    const url = new URL(target.url)
    const signedHeaders = new Set((url.searchParams.get('X-Amz-SignedHeaders') || '').split(';'))

    expect(signedHeaders).toContain('content-type')
    expect(signedHeaders).toContain('if-none-match')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(target.requiredHeaders).toEqual({ 'Content-Type': 'image/webp', 'If-None-Match': '*' })
  })

  it('promotes an object with signed source and destination preconditions', async () => {
    let copyRequest: Request | undefined
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      copyRequest = request
      return new Response(null, { status: 200 })
    }))

    const result = await copyObject(fakeEnv(), 'staging/a memory.jpg', 'originals/final.jpg', 'image/jpeg', 'source-etag')

    expect(result).toEqual({ ok: true, status: 200 })
    expect(copyRequest).toBeDefined()
    expect(copyRequest!.method).toBe('PUT')
    const authorization = copyRequest!.headers.get('Authorization') || ''
    expect(authorization).toContain('AWS4-HMAC-SHA256')
    const signedHeaders = (authorization.match(/SignedHeaders=([^,]+)/)?.[1] || '').split(';')
    expect(signedHeaders).toEqual(expect.arrayContaining([
      'cf-copy-destination-if-none-match',
      'content-type',
      'x-amz-copy-source',
      'x-amz-copy-source-if-match',
      'x-amz-metadata-directive',
    ]))
    expect(copyRequest!.headers.get('x-amz-copy-source')).toBe('/test-bucket/staging/a%20memory.jpg')
    expect(copyRequest!.headers.get('x-amz-copy-source-if-match')).toBe('"source-etag"')
    expect(copyRequest!.headers.get('cf-copy-destination-if-none-match')).toBe('*')
    expect(copyRequest!.headers.get('x-amz-metadata-directive')).toBe('REPLACE')
    expect(copyRequest!.headers.get('Content-Type')).toBe('image/jpeg')
  })

  it('returns a distinct result when a copy precondition fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 412 })))

    await expect(copyObject(fakeEnv(), 'staging/source.jpg', 'originals/final.jpg', 'image/jpeg', '"source-etag"')).resolves.toEqual({ ok: false, status: 412 })
  })

  it('signs downloads as attachments with a bounded lifetime and safe filename', async () => {
    const signed = await signedDownload(fakeEnv(), 'originals/a memory.jpg', 'folder/unsafe\r\n"memory".jpg', 300)
    const url = new URL(signed)
    const disposition = url.searchParams.get('response-content-disposition') || ''

    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(disposition).toBe('attachment; filename="folder_unsafe_memory_.jpg"; filename*=UTF-8\'\'folder_unsafe_memory_.jpg')
    expect(disposition).not.toMatch(/[\r\n]/)
  })

  it('provides an ASCII fallback and an RFC 5987 Unicode filename while stripping bidi and control characters', async () => {
    const signed = await signedDownload(fakeEnv(), 'originals/unicode.jpg', 'Nūrul \u202e\u2066✨\u0000.jpg')
    const disposition = new URL(signed).searchParams.get('response-content-disposition') || ''
    const encodedUnicode = disposition.match(/filename\*=UTF-8''(.+)$/)?.[1] || ''

    expect(disposition).toContain('filename="Nurul _.jpg"')
    expect(encodedUnicode).toContain('%C5%AB')
    expect(decodeURIComponent(encodedUnicode)).toBe('Nūrul ✨.jpg')
    expect(disposition).not.toContain('\u0000')
    expect(disposition).not.toContain('\u202e')
    expect(disposition).not.toContain('\u2066')
  })

  it('neutralizes Windows device names, path characters, empty names, and trailing dots or spaces', async () => {
    const deviceDisposition = new URL(await signedDownload(fakeEnv(), 'originals/device.jpg', 'CON.jpg')).searchParams.get('response-content-disposition') || ''
    const reservedDisposition = new URL(await signedDownload(fakeEnv(), 'originals/reserved.jpg', ' ../bad<>:"/\\|?*.jpg. ')).searchParams.get('response-content-disposition') || ''
    const emptyDisposition = new URL(await signedDownload(fakeEnv(), 'originals/empty', '\u202e\u0000 . ')).searchParams.get('response-content-disposition') || ''
    const reservedUnicode = decodeURIComponent(reservedDisposition.match(/filename\*=UTF-8''(.+)$/)?.[1] || '')

    expect(deviceDisposition).toContain('filename="_CON.jpg"')
    expect(reservedUnicode).not.toMatch(/[<>:"/\\|?*]/)
    expect(reservedUnicode).not.toMatch(/[. ]$/)
    expect(emptyDisposition).toContain('filename="download"')
  })

  it('bounds both fallback and Unicode filenames while preserving a safe extension', async () => {
    const disposition = new URL(await signedDownload(fakeEnv(), 'originals/long.jpeg', `${'é'.repeat(300)}.jpeg`)).searchParams.get('response-content-disposition') || ''
    const asciiDisposition = new URL(await signedDownload(fakeEnv(), 'originals/long-ascii.jpeg', `${'a'.repeat(300)}.jpeg`)).searchParams.get('response-content-disposition') || ''
    const fallback = disposition.match(/filename="([^"]+)"/)?.[1] || ''
    const unicodeFilename = decodeURIComponent(disposition.match(/filename\*=UTF-8''(.+)$/)?.[1] || '')
    const longAsciiFallback = asciiDisposition.match(/filename="([^"]+)"/)?.[1] || ''

    expect(new TextEncoder().encode(fallback).byteLength).toBeLessThanOrEqual(180)
    expect(new TextEncoder().encode(unicodeFilename).byteLength).toBeLessThanOrEqual(180)
    expect(new TextEncoder().encode(longAsciiFallback).byteLength).toBe(180)
    expect(fallback).toMatch(/\.jpeg$/)
    expect(unicodeFilename).toMatch(/\.jpeg$/)
    expect(longAsciiFallback).toMatch(/\.jpeg$/)
    expect(fallback).toMatch(/^[\x20-\x7e]+$/)
  })
})
