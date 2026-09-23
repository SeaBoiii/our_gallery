import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ API_BASE_URL: 'https://api.example.test', USE_MOCK_DATA: true }))
vi.mock('../../config', () => config)

describe('greeting API and development state', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    config.USE_MOCK_DATA = true
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('keeps submitted wishes pending until approval, supports rejection and deletion, and preserves media statistics', async () => {
    const api = await import('../../services/api')
    const before = await api.getAdminStats()
    const payload = { requestId: crypto.randomUUID(), guestName: '  Nur  ', message: '  A lifetime of love.  ', turnstileToken: 'dev' }
    const receipt = await api.createGreeting(payload)
    expect(receipt.status).toBe('pending')
    expect((await api.getGreetings()).items.some((item) => item.id === receipt.id)).toBe(false)
    expect((await api.getAdminGreetings({ status: 'pending' })).items).toContainEqual(expect.objectContaining({ id: receipt.id, guestName: 'Nur', message: 'A lifetime of love.' }))
    expect(await api.createGreeting({ ...payload, turnstileToken: 'fresh' })).toEqual(receipt)
    expect((await api.getAdminGreetingStats()).pending).toBe(1)
    await expect(api.createGreeting({ ...payload, message: 'Changed words.' })).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' })
    await api.updateAdminGreetings([receipt.id], 'approved')
    expect((await api.getGreetings()).items).toContainEqual(expect.objectContaining({ id: receipt.id }))
    await api.updateAdminGreetings([receipt.id], 'rejected')
    expect((await api.getGreetings()).items.some((item) => item.id === receipt.id)).toBe(false)
    await api.updateAdminGreetings([receipt.id], 'approved')
    await api.deleteAdminGreeting(receipt.id)
    expect((await api.getGreetings()).items.some((item) => item.id === receipt.id)).toBe(false)
    expect((await api.getAdminGreetings()).items.some((item) => item.id === receipt.id)).toBe(false)
    expect(await api.createGreeting(payload)).toEqual({ id: receipt.id, status: 'deleted' })
    expect(await api.getAdminStats()).toEqual(before)
  })

  it('controls greetings independently of uploads and never auto-approves written wishes', async () => {
    const api = await import('../../services/api')
    await api.updateAdminSettings({ uploadsEnabled: false, autoApproveUploads: true })
    const receipt = await api.createGreeting({ requestId: crypto.randomUUID(), message: 'Still able to send love.', turnstileToken: 'dev' })
    expect(receipt.status).toBe('pending')
    await api.updateAdminSettings({ greetingsEnabled: false })
    expect((await api.getGreetings()).submissionsOpen).toBe(false)
    expect((await api.getGreetings()).items.length).toBeGreaterThan(0)
    await expect(api.createGreeting({ requestId: crypto.randomUUID(), message: 'New greeting.', turnstileToken: 'dev' })).rejects.toMatchObject({ code: 'GREETINGS_CLOSED' })
    expect(await api.getAdminSettings()).toMatchObject({ uploadsEnabled: false, autoApproveUploads: true, greetingsEnabled: false })
  })

  it('uses the real API when mocks are disabled and never automatically replays a single-use verification token', async () => {
    config.USE_MOCK_DATA = false
    const fetch = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetch)
    const api = await import('../../services/api')
    const payload = { requestId: crypto.randomUUID(), message: 'A real wish.', turnstileToken: 'single-use' }
    await expect(api.createGreeting(payload)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('https://api.example.test/api/greetings', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(payload) }))
  })

  it('continues fetching with a stable valid session when browser storage is denied', async () => {
    config.USE_MOCK_DATA = false
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true, data: { items: [], nextCursor: null, submissionsOpen: true } }), { status: 200 })))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Access denied', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Access denied', 'SecurityError') })
    const api = await import('../../services/api')
    await api.getGreetings()
    await api.getGreetings()
    expect(fetch).toHaveBeenCalledTimes(2)
    const firstSession = fetch.mock.calls[0][1].headers['X-Gallery-Session']
    expect(firstSession).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(fetch.mock.calls[1][1].headers['X-Gallery-Session']).toBe(firstSession)
  })

  it('replaces malformed stored sessions and announces an expired admin session', async () => {
    config.USE_MOCK_DATA = false
    window.localStorage.setItem('an-gallery-session', 'invalid-value')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: { code: 'SESSION_EXPIRED', message: 'Sign in again.' } }), { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    const api = await import('../../services/api')
    const expired = vi.fn()
    window.addEventListener(api.ADMIN_SESSION_EXPIRED_EVENT, expired)
    try {
      await expect(api.getAdminGreetings()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
      expect(expired).toHaveBeenCalledOnce()
      expect(fetch.mock.calls[0][1].headers['X-Gallery-Session']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      expect(window.localStorage.getItem('an-gallery-session')).toBe(fetch.mock.calls[0][1].headers['X-Gallery-Session'])
    } finally { window.removeEventListener(api.ADMIN_SESSION_EXPIRED_EVENT, expired) }
  })
})
