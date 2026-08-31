import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeEnv } from '../../test/fake'
import { copyObject, signedPut } from './signing'

afterEach(() => vi.unstubAllGlobals())

describe('R2 signing', () => {
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
})
