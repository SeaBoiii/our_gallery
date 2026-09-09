import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeEnv } from '../test/fake'
import { fetchHandler } from './index'

describe('Worker error boundary', () => {
  afterEach(() => vi.useRealTimers())

  it('returns a friendly 403 envelope for a mutation without Origin', async () => {
    const response = await fetchHandler(new Request('https://api.test/api/uploads/prepare',{ method:'POST',headers:{'Content-Type':'application/json'},body:'{}' }),fakeEnv())
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ ok:false,error:{ code:'ORIGIN_REQUIRED' } })
  })

  it('serves the public download status route with the configured boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2027-08-22T15:59:59.000Z')
    const response = await fetchHandler(new Request('https://api.test/api/gallery/download-status'), fakeEnv())

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { available: false, availableAt: '2027-08-23T00:00:00+08:00' } })
  })

  it('returns the documented 403 without querying media before downloads open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2027-08-22T15:59:59.999Z')
    const query = vi.fn()
    const response = await fetchHandler(
      new Request('https://api.test/api/gallery/00000000-0000-4000-8000-000000000001/download'),
      fakeEnv({ first: query }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'DOWNLOADS_NOT_YET_AVAILABLE',
        retryable: false,
        details: { availableAt: '2027-08-23T00:00:00+08:00' },
      },
    })
    expect(query).not.toHaveBeenCalled()
  })
})
