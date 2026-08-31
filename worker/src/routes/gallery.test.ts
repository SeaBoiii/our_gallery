import { describe, expect, it } from 'vitest'
import { galleryRoute } from './gallery'
import { fakeEnv } from '../../test/fake'

describe('public gallery', () => {
  it('queries approved media only', async () => {
    let sql = ''
    const env = fakeEnv({ all: (statement) => { sql = statement; return [] } })
    const response = await galleryRoute(new Request('https://api.test/api/gallery'),env)
    expect(response.status).toBe(200)
    expect(sql).toContain("m.status = 'approved'")
  })
})
