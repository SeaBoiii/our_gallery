import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminGreetingPage, AdminGreetingStats, ApiEnvelope, CreateGreetingReceipt, GreetingPage } from '../../shared/contracts'
import { sqliteEnv } from './sqlite'
import { createAdminSession } from '../src/security/adminSession'
import { rateLimit } from '../src/security/rateLimit'
import { fetchHandler } from '../src/index'
import { adminSettingsRoute, adminUpdateSettingsRoute } from '../src/routes/admin'
import { adminBatchGreetingsRoute, adminDeleteGreetingRoute, adminGreetingStatsRoute, adminGreetingsRoute, createGreetingRoute, greetingsRoute } from '../src/routes/greetings'

const origin = 'http://localhost:5173'
const session = '52d0b802-1bee-48be-bb11-d8a2331f9e09'
const headers = { Origin: origin, 'X-Gallery-Session': session, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' }
const draft = () => ({ requestId: crypto.randomUUID(), guestName: ' Auntie Mariam ', message: ' May your marriage be full of love. ', turnstileToken: 'development-bypass' })
const createRequest = (payload: unknown, extraHeaders: Record<string, string> = {}) => new Request('https://api.test/api/greetings', { method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(payload) })
async function data<T>(response: Response): Promise<T> {
  const body = await response.json() as ApiEnvelope<T>
  if (!body.ok) throw new Error(body.error.code)
  return body.data
}

describe('guestbook on real SQLite', () => {
  let fixture: ReturnType<typeof sqliteEnv>
  beforeEach(() => { fixture = sqliteEnv() })
  afterEach(() => { fixture?.close(); vi.unstubAllGlobals() })

  function seed(status = 'approved', createdAt = '2027-08-21T01:00:00.000Z') {
    const id = crypto.randomUUID()
    fixture.database.prepare('INSERT INTO greetings(id,request_id,session_hash,intent_hash,guest_name,message,status,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, crypto.randomUUID(), 'session-hash', 'intent-hash', 'A guest', 'Wishing you every happiness.', status, createdAt)
    return id
  }

  async function adminRequest(path: string, method = 'GET', body?: unknown) {
    const admin = await createAdminSession(fixture.env)
    return new Request(`https://api.test${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: admin.cookie.split(';')[0] }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }

  it('stores text-only greetings as pending even when media auto-approval is enabled', async () => {
    fixture.env.AUTO_APPROVE_UPLOADS = 'true'
    fixture.database.exec("UPDATE settings SET value='true' WHERE key='auto_approve_uploads'")
    const response = await createGreetingRoute(createRequest(draft()), fixture.env)
    expect(response.status).toBe(201)
    const receipt = await data<CreateGreetingReceipt>(response)
    expect(receipt.status).toBe('pending')
    expect(fixture.database.prepare('SELECT guest_name,message,status FROM greetings WHERE id=?').get(receipt.id)).toMatchObject({ guest_name: 'Auntie Mariam', message: 'May your marriage be full of love.', status: 'pending' })
    expect(fixture.database.prepare('SELECT COUNT(*) AS total FROM media').get()).toMatchObject({ total: 0 })
    const page = await data<GreetingPage>(await greetingsRoute(new Request('https://api.test/api/greetings'), fixture.env))
    expect(page).toEqual({ items: [], nextCursor: null, submissionsOpen: true })
  })

  it.each([
    [null, 'INVALID_GREETING'],
    [[], 'INVALID_GREETING'],
    [{ message: '   ' }, 'INVALID_GREETING_MESSAGE'],
    [{ message: 123 }, 'INVALID_GREETING_MESSAGE'],
    [{ message: '\0hello' }, 'INVALID_GREETING_MESSAGE'],
    [{ message: 'a'.repeat(1001) }, 'INVALID_GREETING_MESSAGE'],
    [{ guestName: [] }, 'INVALID_GUEST_NAME'],
    [{ guestName: 'Guest\0name' }, 'INVALID_GUEST_NAME'],
    [{ guestName: 'a'.repeat(81) }, 'INVALID_GUEST_NAME'],
    [{ requestId: 'not-a-uuid' }, 'INVALID_REQUEST_ID'],
    [{ turnstileToken: null }, 'TURNSTILE_REQUIRED'],
  ])('validates the runtime submission shape: %j', async (patch, code) => {
    const payload = patch && !Array.isArray(patch) ? { ...draft(), ...patch } : patch
    await expect(createGreetingRoute(createRequest(payload), fixture.env)).rejects.toMatchObject({ status: 400, code })
    expect(fixture.database.prepare('SELECT COUNT(*) AS total FROM greetings').get()).toMatchObject({ total: 0 })
  })

  it('keeps greeting text literal and excludes session and moderation metadata from public output', async () => {
    const payload = { ...draft(), guestName: '', message: '<script>alert("hi")</script> ♥' }
    const receipt = await data<CreateGreetingReceipt>(await createGreetingRoute(createRequest(payload), fixture.env))
    fixture.database.prepare("UPDATE greetings SET status='approved' WHERE id=?").run(receipt.id)
    const response = await greetingsRoute(new Request('https://api.test/api/greetings'), fixture.env)
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    const page = await data<GreetingPage>(response)
    expect(page.items[0]).toEqual({ id: receipt.id, guestName: null, message: payload.message, createdAt: expect.any(String) })
  })

  it('returns one receipt for concurrent identical submissions and retry without reusing a token', async () => {
    const payload = draft()
    const responses = await Promise.all([createGreetingRoute(createRequest(payload), fixture.env), createGreetingRoute(createRequest(payload), fixture.env)])
    const receipts = await Promise.all(responses.map((response) => data<CreateGreetingReceipt>(response)))
    expect(receipts[0]).toEqual(receipts[1])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201])
    expect(fixture.database.prepare('SELECT COUNT(*) AS total FROM greetings').get()).toMatchObject({ total: 1 })
    fixture.env.TURNSTILE_BYPASS = 'false'
    const verify = vi.fn()
    vi.stubGlobal('fetch', verify)
    const retry = await createGreetingRoute(createRequest({ ...payload, turnstileToken: '' }), fixture.env)
    expect(await data<CreateGreetingReceipt>(retry)).toEqual(receipts[0])
    expect(verify).not.toHaveBeenCalled()
  })

  it('rejects reuse of a request ID with different content or browser session', async () => {
    const payload = draft()
    await createGreetingRoute(createRequest(payload), fixture.env)
    await expect(createGreetingRoute(createRequest({ ...payload, message: 'A changed message.' }), fixture.env)).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT', status: 409 })
    await expect(createGreetingRoute(createRequest(payload, { 'X-Gallery-Session': crypto.randomUUID() }), fixture.env)).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT', status: 409 })
  })

  it('does not count idempotent retries as new submissions and limits a session to five', async () => {
    const payload = draft()
    await createGreetingRoute(createRequest(payload), fixture.env)
    for (let index = 0; index < 6; index++) expect((await createGreetingRoute(createRequest(payload), fixture.env)).status).toBe(200)
    for (let index = 0; index < 4; index++) await createGreetingRoute(createRequest(draft()), fixture.env)
    await expect(createGreetingRoute(createRequest(draft()), fixture.env)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' })
    expect(fixture.database.prepare('SELECT COUNT(*) AS total FROM greetings').get()).toMatchObject({ total: 5 })
  })

  it('enforces the venue-IP limit independently of the browser session', async () => {
    await rateLimit(fixture.env, 'greeting-ip:203.0.113.10', 'greeting_submit', 300, 600, 300)
    await expect(createGreetingRoute(createRequest(draft()), fixture.env)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' })
  })

  it('uses the greeting Turnstile action and hostname while preserving single-use verification', async () => {
    fixture.env.TURNSTILE_BYPASS = 'false'
    const verify = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, action: 'greeting_submit', hostname: 'localhost' })))
    vi.stubGlobal('fetch', verify)
    const payload = { ...draft(), turnstileToken: 'single-use-token' }
    expect((await createGreetingRoute(createRequest(payload), fixture.env)).status).toBe(201)
    expect((await createGreetingRoute(createRequest(payload), fixture.env)).status).toBe(200)
    expect(verify).toHaveBeenCalledTimes(1)
    const verificationBody = JSON.parse(String(verify.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(verificationBody.response).toBe('single-use-token')
    expect(verificationBody).not.toHaveProperty('idempotency_key')
  })

  it.each([
    { success: true, action: 'upload_prepare', hostname: 'localhost' },
    { success: true, action: 'greeting_submit', hostname: 'other.example' },
    { success: false, action: 'greeting_submit', hostname: 'localhost' },
  ])('rejects invalid verification before inserting: %j', async (verification) => {
    fixture.env.TURNSTILE_BYPASS = 'false'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(verification))))
    await expect(createGreetingRoute(createRequest(draft()), fixture.env)).rejects.toMatchObject({ code: 'TURNSTILE_FAILED' })
    expect(fixture.database.prepare('SELECT COUNT(*) AS total FROM greetings').get()).toMatchObject({ total: 0 })
  })

  it('requires allowed origin and a valid browser session; rejects oversized JSON', async () => {
    const missingOrigin = createRequest(draft())
    missingOrigin.headers.delete('Origin')
    await expect(createGreetingRoute(missingOrigin, fixture.env)).rejects.toMatchObject({ code: 'ORIGIN_REQUIRED' })
    await expect(createGreetingRoute(createRequest(draft(), { Origin: 'https://other.example' }), fixture.env)).rejects.toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' })
    await expect(createGreetingRoute(createRequest(draft(), { 'X-Gallery-Session': 'bad' }), fixture.env)).rejects.toMatchObject({ code: 'INVALID_SESSION' })
    await expect(createGreetingRoute(createRequest({ ...draft(), message: 'x'.repeat(140_000) }), fixture.env)).rejects.toMatchObject({ status: 413 })
  })

  it('closes new greetings independently of media while allowing successful replay', async () => {
    fixture.database.exec("UPDATE settings SET value='false' WHERE key='uploads_enabled'")
    const payload = draft()
    await createGreetingRoute(createRequest(payload), fixture.env)
    const settingsResponse = await adminUpdateSettingsRoute(await adminRequest('/api/admin/settings', 'PATCH', { greetingsEnabled: false }), fixture.env)
    expect(await data(settingsResponse)).toMatchObject({ greetingsEnabled: false, uploadsEnabled: false })
    expect((await createGreetingRoute(createRequest(payload), fixture.env)).status).toBe(200)
    await expect(createGreetingRoute(createRequest(draft()), fixture.env)).rejects.toMatchObject({ code: 'GREETINGS_CLOSED' })
    const page = await data<GreetingPage>(await greetingsRoute(new Request('https://api.test/api/greetings'), fixture.env))
    expect(page.submissionsOpen).toBe(false)
  })

  it('checks closure again atomically if settings change during verification', async () => {
    fixture.env.TURNSTILE_BYPASS = 'false'
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      fixture.database.exec("UPDATE settings SET value='false' WHERE key='greetings_enabled'")
      return new Response(JSON.stringify({ success: true, action: 'greeting_submit', hostname: 'localhost' }))
    }))
    await expect(createGreetingRoute(createRequest(draft()), fixture.env)).rejects.toMatchObject({ code: 'GREETINGS_CLOSED' })
    expect(fixture.database.prepare('SELECT COUNT(*) AS total FROM greetings').get()).toMatchObject({ total: 0 })
  })

  it('defaults missing greeting settings to open for additive compatibility', async () => {
    fixture.database.exec("DELETE FROM settings WHERE key='greetings_enabled'")
    expect(await data(await adminSettingsRoute(await adminRequest('/api/admin/settings'), fixture.env))).toMatchObject({ greetingsEnabled: true })
    expect((await createGreetingRoute(createRequest(draft()), fixture.env)).status).toBe(201)
  })

  it('paginates approved greetings deterministically and never leaks hidden statuses', async () => {
    const approved = Array.from({ length: 5 }, () => seed()).sort().reverse()
    seed('pending'); seed('rejected')
    const first = await data<GreetingPage>(await greetingsRoute(new Request('https://api.test/api/greetings?limit=3&status=pending'), fixture.env))
    expect(first.items.map((item) => item.id)).toEqual(approved.slice(0, 3))
    const second = await data<GreetingPage>(await greetingsRoute(new Request(`https://api.test/api/greetings?limit=3&cursor=${first.nextCursor}`), fixture.env))
    expect(second.items.map((item) => item.id)).toEqual(approved.slice(3))
    expect(second.nextCursor).toBeNull()
    expect(first.items[0]).not.toHaveProperty('status')
  })

  it('bounds pagination and validates malformed cursors and limits', async () => {
    for (let index = 0; index < 51; index++) seed()
    const page = await data<GreetingPage>(await greetingsRoute(new Request('https://api.test/api/greetings?limit=100000'), fixture.env))
    expect(page.items).toHaveLength(50)
    for (const query of ['limit=NaN', 'limit=-1', 'limit=2.5', 'cursor=bad-cursor']) {
      await expect(greetingsRoute(new Request(`https://api.test/api/greetings?${query}`), fixture.env)).rejects.toMatchObject({ status: 400 })
    }
  })

  it('protects every admin route with origin and authentication checks', async () => {
    const request = new Request('https://api.test/api/admin/greetings', { headers: { Origin: origin } })
    await expect(adminGreetingsRoute(request, fixture.env)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' })
    await expect(adminGreetingStatsRoute(request, fixture.env)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' })
    await expect(adminBatchGreetingsRoute(request, fixture.env)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' })
    await expect(adminDeleteGreetingRoute(request, fixture.env, crypto.randomUUID())).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' })
    const missingOrigin = await adminRequest('/api/admin/greetings')
    missingOrigin.headers.delete('Origin')
    await expect(adminGreetingsRoute(missingOrigin, fixture.env)).rejects.toMatchObject({ code: 'ORIGIN_REQUIRED' })
  })

  it('moderates 100 entries within parameter limits, filters pending rows and logs the action', async () => {
    const ids = Array.from({ length: 100 }, () => seed('pending'))
    const pending = await data<AdminGreetingPage>(await adminGreetingsRoute(await adminRequest('/api/admin/greetings?status=pending&limit=10'), fixture.env))
    expect(pending.items).toHaveLength(10)
    const result = await data(await adminBatchGreetingsRoute(await adminRequest('/api/admin/greetings/batch', 'PATCH', { ids, status: 'approved' }), fixture.env))
    expect(result).toEqual({ updated: 100 })
    const stats = await data<AdminGreetingStats>(await adminGreetingStatsRoute(await adminRequest('/api/admin/greetings/stats'), fixture.env))
    expect(stats).toEqual({ total: 100, pending: 0, approved: 100, rejected: 0 })
    expect(fixture.database.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action='greeting_approved'").get()).toMatchObject({ total: 1 })
    await adminBatchGreetingsRoute(await adminRequest('/api/admin/greetings/batch', 'PATCH', { ids: [ids[0]], status: 'rejected' }), fixture.env)
    const publicPage = await data<GreetingPage>(await greetingsRoute(new Request('https://api.test/api/greetings?limit=50'), fixture.env))
    expect(publicPage.items.some((item) => item.id === ids[0])).toBe(false)
  })

  it('clears deleted text but retains its request tombstone and cannot resurrect it', async () => {
    const payload = draft()
    const receipt = await data<CreateGreetingReceipt>(await createGreetingRoute(createRequest(payload), fixture.env))
    const deleteRequest = await adminRequest(`/api/admin/greetings/${receipt.id}`, 'DELETE')
    expect(await data(await adminDeleteGreetingRoute(deleteRequest, fixture.env, receipt.id))).toEqual({ deleted: true })
    expect(await data<CreateGreetingReceipt>(await createGreetingRoute(createRequest(payload), fixture.env))).toEqual({ id: receipt.id, status: 'deleted' })
    expect(fixture.database.prepare('SELECT message,guest_name,status FROM greetings WHERE id=?').get(receipt.id)).toMatchObject({ message: '', guest_name: null, status: 'deleted' })
    expect(await data(await adminBatchGreetingsRoute(await adminRequest('/api/admin/greetings/batch', 'PATCH', { ids: [receipt.id], status: 'approved' }), fixture.env))).toEqual({ updated: 0 })
    expect(await data(await adminDeleteGreetingRoute(await adminRequest(`/api/admin/greetings/${receipt.id}`, 'DELETE'), fixture.env, receipt.id))).toEqual({ deleted: true })
    expect(await data(await adminGreetingStatsRoute(await adminRequest('/api/admin/greetings/stats'), fixture.env))).toEqual({ total: 0, pending: 0, approved: 0, rejected: 0 })
  })

  it('rejects malformed moderation payloads instead of changing rows', async () => {
    for (const payload of [null, { ids: [], status: 'approved' }, { ids: [123], status: 'approved' }, { ids: [crypto.randomUUID()], status: 'deleted' }]) {
      await expect(adminBatchGreetingsRoute(await adminRequest('/api/admin/greetings/batch', 'PATCH', payload), fixture.env)).rejects.toMatchObject({ code: 'INVALID_MODERATION' })
    }
  })

  it('retires public greeting routes without modifying rows and keeps authenticated archive access', async () => {
    const id = seed('pending')
    const originalRows = fixture.database.prepare('SELECT * FROM greetings ORDER BY id').all()
    expect((await fetchHandler(createRequest(draft()), fixture.env)).status).toBe(410)
    expect((await fetchHandler(new Request('https://api.test/api/greetings'), fixture.env)).status).toBe(410)
    expect(fixture.database.prepare('SELECT * FROM greetings ORDER BY id').all()).toEqual(originalRows)
    expect((await fetchHandler(await adminRequest('/api/admin/greetings'), fixture.env)).status).toBe(200)
    expect((await fetchHandler(await adminRequest('/api/admin/greetings/stats'), fixture.env)).status).toBe(200)
    expect((await fetchHandler(await adminRequest('/api/admin/greetings/batch', 'PATCH', { ids: [id], status: 'approved' }), fixture.env)).status).toBe(200)
    expect((await fetchHandler(await adminRequest(`/api/admin/greetings/${id}`, 'DELETE'), fixture.env)).status).toBe(200)
  })
})

describe('guestbook migration compatibility', () => {
  it('preserves existing media byte-for-byte and adds database constraints', () => {
    const fixture = sqliteEnv(2)
    try {
      fixture.database.exec(readFileSync(resolve('worker/seeds/development.sql'), 'utf8'))
      fixture.database.exec("UPDATE settings SET value='true' WHERE key='auto_approve_uploads'")
      const original = fixture.database.prepare('SELECT * FROM media ORDER BY id').all()
      fixture.applyMigration('0003_greetings.sql')
      expect(fixture.database.prepare('SELECT * FROM media ORDER BY id').all()).toEqual(original)
      expect(fixture.database.prepare("SELECT value FROM settings WHERE key='auto_approve_uploads'").get()).toMatchObject({ value: 'false' })
      expect(fixture.database.prepare("SELECT display_name FROM events WHERE slug='solemnisation'").get()).toMatchObject({ display_name: "Nikah & Bride's Reception" })
      const insert = fixture.database.prepare('INSERT INTO greetings(id,request_id,session_hash,intent_hash,message,status,created_at) VALUES(?,?,?,?,?,?,?)')
      const requestId = crypto.randomUUID()
      insert.run(crypto.randomUUID(), requestId, 'session', 'intent', 'Congratulations!', 'pending', '2027-08-21T01:00:00.000Z')
      expect(() => insert.run(crypto.randomUUID(), requestId, 'session', 'intent', 'Congratulations!', 'pending', '2027-08-21T01:00:00.000Z')).toThrow(/UNIQUE/)
      expect(() => insert.run(crypto.randomUUID(), crypto.randomUUID(), 'session', 'intent', '', 'pending', '2027-08-21T01:00:00.000Z')).toThrow(/CHECK/)
      expect(() => insert.run(crypto.randomUUID(), crypto.randomUUID(), 'session', 'intent', 'Hello', 'invalid', '2027-08-21T01:00:00.000Z')).toThrow(/CHECK/)
    } finally { fixture.close() }
  })
})
