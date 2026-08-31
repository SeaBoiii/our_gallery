import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type CorsPolicy = {
  rules: Array<{
    allowed: {
      origins: string[]
      methods: string[]
      headers?: string[]
    }
    exposeHeaders?: string[]
    maxAgeSeconds?: number
  }>
}

function loadPolicy(environment: 'production' | 'development') {
  const source = readFileSync(resolve(process.cwd(), 'worker', `r2-cors.${environment}.json`), 'utf8')
  return JSON.parse(source) as CorsPolicy
}

describe('R2 CORS policies', () => {
  it.each(['production', 'development'] as const)('uses Wrangler R2 API format for %s', (environment) => {
    const policy = loadPolicy(environment)

    expect(policy.rules).toHaveLength(1)
    expect(policy.rules[0]).toMatchObject({
      allowed: {
        methods: ['GET', 'HEAD', 'PUT'],
        headers: ['Content-Type', 'If-None-Match'],
      },
      exposeHeaders: ['ETag'],
      maxAgeSeconds: 3600,
    })
    expect(policy.rules[0].allowed.origins.length).toBeGreaterThan(0)
  })

  it('keeps the production bucket restricted to the gallery origin', () => {
    expect(loadPolicy('production').rules[0].allowed.origins).toEqual([
      'https://gallery.aleemxnurul.love',
    ])
  })
})
