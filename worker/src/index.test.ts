import { describe, expect, it } from 'vitest'
import { fakeEnv } from '../test/fake'
import { fetchHandler } from './index'

describe('Worker error boundary', () => {
  it('returns a friendly 403 envelope for a mutation without Origin', async () => {
    const response = await fetchHandler(new Request('https://api.test/api/uploads/prepare',{ method:'POST',headers:{'Content-Type':'application/json'},body:'{}' }),fakeEnv())
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ ok:false,error:{ code:'ORIGIN_REQUIRED' } })
  })
})
