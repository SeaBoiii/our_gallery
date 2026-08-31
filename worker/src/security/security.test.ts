import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError, requireOrigin } from '../lib/http'
import { verifyAdminPassword } from './adminSession'
import { rateLimit } from './rateLimit'
import { verifyTurnstile } from './turnstile'
import { fakeEnv } from '../../test/fake'
import { assertSafeConfiguration } from '../env'

afterEach(() => vi.unstubAllGlobals())

describe('worker security', () => {
  it('rejects missing and disallowed origins', () => {
    const env = fakeEnv()
    expect(() => requireOrigin(new Request('https://api.test'),env)).toThrowError(/verified/)
    expect(() => requireOrigin(new Request('https://api.test',{ headers:{ Origin:'https://evil.example' } }),env)).toThrowError(/not allowed/)
  })

  it('rejects invalid Turnstile verification', async () => {
    const env = { ...fakeEnv(), ENVIRONMENT:'production', TURNSTILE_BYPASS:'false', TURNSTILE_EXPECTED_HOSTNAME:'gallery.aleemxnurul.love' }
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({ success:false }),{ status:200,headers:{'Content-Type':'application/json'} })))
    await expect(verifyTurnstile(env,'bad-token','203.0.113.10')).rejects.toMatchObject({ code:'TURNSTILE_FAILED' })
  })

  it('does not turn a browser request ID into a replayable Turnstile idempotency key', async () => {
    const env = { ...fakeEnv(), ENVIRONMENT:'production', TURNSTILE_BYPASS:'false', TURNSTILE_EXPECTED_HOSTNAME:'gallery.aleemxnurul.love' }
    const verify = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success:true,hostname:'gallery.aleemxnurul.love',action:'upload_prepare' }),{ status:200,headers:{'Content-Type':'application/json'} }))
    vi.stubGlobal('fetch',verify)
    await verifyTurnstile(env,'one-use-token','203.0.113.10')
    const body = JSON.parse(String(verify.mock.calls[0][1]?.body)) as Record<string,unknown>
    expect(body).not.toHaveProperty('idempotency_key')
  })

  it('enforces rate limits', async () => {
    const env = fakeEnv({ first: (sql) => sql.includes('INSERT INTO rate_limits') ? { count: 3 } : null })
    await expect(rateLimit(env,'session','prepare',2,60)).rejects.toBeInstanceOf(HttpError)
  })

  it('compares the admin password without exposing it to the client', async () => {
    const env = fakeEnv()
    await expect(verifyAdminPassword(env,'correct horse battery staple')).resolves.toBe(true)
    await expect(verifyAdminPassword(env,'wrong')).resolves.toBe(false)
  })

  it('fails closed when production secrets or identifiers are placeholders', () => {
    const env = { ...fakeEnv(), ENVIRONMENT:'production', TURNSTILE_BYPASS:'false', R2_ACCOUNT_ID:'REPLACE_WITH_CLOUDFLARE_ACCOUNT_ID' }
    expect(() => assertSafeConfiguration(env)).toThrowError(/R2_ACCOUNT_ID/)
  })
})
