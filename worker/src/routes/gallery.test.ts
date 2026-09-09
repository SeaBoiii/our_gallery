import { afterEach, describe, expect, it, vi } from 'vitest'
import { galleryDownloadRoute, galleryDownloadStatusRoute, galleryRoute } from './gallery'
import { fakeEnv } from '../../test/fake'

afterEach(() => vi.useRealTimers())

describe('public gallery', () => {
  it('queries approved media only', async () => {
    let sql = ''
    const env = fakeEnv({ all: (statement) => { sql = statement; return [] } })
    const response = await galleryRoute(new Request('https://api.test/api/gallery'),env)
    expect(response.status).toBe(200)
    expect(sql).toContain("m.status = 'approved'")
  })

  it('issues a short-lived original download only through the approved-media predicate', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2027-08-22T16:00:00.000Z')
    let sql = ''
    const env = fakeEnv({ first: (statement) => {
      sql = statement
      return { original_object_key:'originals/solemnisation/memory.jpg',original_filename:'Our memory.jpg' }
    } })
    const response = await galleryDownloadRoute(new Request('https://api.test/api/gallery/00000000-0000-4000-8000-000000000001/download'),env,'00000000-0000-4000-8000-000000000001')
    const body = await response.json() as { ok:true;data:{ url:string;expiresInSeconds:number } }

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(sql).toContain("m.status='approved'")
    expect(sql).toContain('m.display_object_key IS NOT NULL')
    expect(body.data.expiresInSeconds).toBe(300)
    const url = new URL(body.data.url)
    expect(url.pathname).toBe('/test-bucket/originals/solemnisation/memory.jpg')
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="Our memory.jpg"; filename*=UTF-8\'\'Our%20memory.jpg')
  })

  it('does not expose a download URL for media outside the public gallery', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2027-08-22T16:00:00.000Z')
    const env = fakeEnv({ first: () => null })
    await expect(galleryDownloadRoute(new Request('https://api.test/api/gallery/00000000-0000-4000-8000-000000000001/download'),env,'00000000-0000-4000-8000-000000000001'))
      .rejects.toMatchObject({ status:404,code:'MEDIA_NOT_FOUND' })
  })

  it('reports server-authoritative availability without caching the boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2027-08-22T15:59:59.000Z')
    const response = galleryDownloadStatusRoute(new Request('https://api.test/api/gallery/download-status'), fakeEnv())

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        available: false,
        availableAt: '2027-08-23T00:00:00+08:00',
        serverTime: '2027-08-22T15:59:59.000Z',
      },
    })
  })

  it('rejects guest downloads before release without querying D1', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2027-08-22T15:59:59.999Z')
    const query = vi.fn(() => ({ original_object_key:'originals/solemnisation/memory.jpg',original_filename:'Our memory.jpg' }))
    const env = fakeEnv({ first: query })

    await expect(galleryDownloadRoute(new Request('https://api.test/api/gallery/00000000-0000-4000-8000-000000000001/download'), env, '00000000-0000-4000-8000-000000000001'))
      .rejects.toMatchObject({ status: 403, code: 'DOWNLOADS_NOT_YET_AVAILABLE', details: { availableAt: '2027-08-23T00:00:00+08:00' } })
    expect(query).not.toHaveBeenCalled()
  })
})
