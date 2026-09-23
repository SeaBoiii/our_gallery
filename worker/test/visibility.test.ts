import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiEnvelope, GalleryDayMode, GalleryDownloadResponse, GalleryPage, GallerySettings, GalleryVisibilitySetting, PrepareUploadRequest, PrepareUploadResponse, PublicGalleryConfig } from '../../shared/contracts'
import { DEFAULT_GALLERY_VISIBILITY } from '../../shared/visibility'
import { sqliteEnv } from './sqlite'
import { fetchHandler } from '../src/index'
import { createAdminSession } from '../src/security/adminSession'

const origin = 'http://localhost:5173'
const guestHeaders = { Origin: origin, 'Content-Type': 'application/json', 'X-Gallery-Session': '52d0b802-1bee-48be-bb11-d8a2331f9e09' }
const bytes = new TextEncoder().encode('0123456789')
const etag = '"fixture-etag"'

async function data<T>(response: Response): Promise<T> {
  const body = await response.json() as ApiEnvelope<T>
  if (!body.ok) throw new Error(`${response.status}: ${body.error.code}`)
  return body.data
}

describe('visibility APIs and protected media on real SQLite', () => {
  let fixture: ReturnType<typeof sqliteEnv>
  let objects: Map<string, Uint8Array>
  let head: ReturnType<typeof vi.fn>
  let get: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime('2027-08-21T02:00:00Z')
    fixture = sqliteEnv()
    objects = new Map()
    setPolicy(DEFAULT_GALLERY_VISIBILITY)
    head = vi.fn(async (key: string) => {
      const content = objects.get(key)
      return content ? { key, size: content.byteLength, etag: 'fixture-etag', httpEtag: etag, uploaded: new Date('2027-08-20T00:00:00Z'), httpMetadata: { contentType: key.endsWith('.webp') ? 'image/webp' : 'image/jpeg' } } : null
    })
    get = vi.fn(async (key: string, options?: { range?: { offset: number; length: number } }) => {
      const content = objects.get(key)
      if (!content) return null
      const selected = options?.range ? content.slice(options.range.offset, options.range.offset + options.range.length) : content
      return { body: new ReadableStream({ start(controller) { controller.enqueue(selected); controller.close() } }), arrayBuffer: async () => selected.buffer }
    })
    fixture.env.MEDIA = { head, get, delete: vi.fn(async () => undefined) } as unknown as R2Bucket
  })
  afterEach(() => { fixture.close(); vi.useRealTimers(); vi.unstubAllGlobals() })

  function setPolicy(policy: GalleryVisibilitySetting) {
    fixture.database.prepare("UPDATE settings SET value=?,updated_at=? WHERE key='gallery_visibility'").run(JSON.stringify(policy), new Date().toISOString())
  }
  function mode(value: GalleryDayMode) { setPolicy({ control: 'manual', mode: value, lastSingleDay: 'solemnisation', overrideUntil: null }) }
  function request(path: string, init?: RequestInit) { return fetchHandler(new Request(new URL(path, 'https://api.test'), init), fixture.env) }
  async function admin(path = '/api/admin/settings', method = 'GET', body?: unknown) {
    const session = await createAdminSession(fixture.env)
    return request(path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie.split(';')[0] }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  function seed(event: 'solemnisation' | 'reception', mediaType: 'photo' | 'video' = 'photo', status = 'approved') {
    const id = crypto.randomUUID()
    const key = `originals/${event}/${id}.${mediaType === 'video' ? 'mp4' : 'jpg'}`
    const display = mediaType === 'photo' ? `display/${id}.webp` : null
    const thumbnail = mediaType === 'photo' ? `thumbnails/${id}.webp` : null
    fixture.database.prepare(`INSERT INTO media(id,request_id,client_id,event_id,media_type,mime_type,staging_original_object_key,original_object_key,display_object_key,thumbnail_object_key,original_filename,size_bytes,fingerprint,intent_hash,session_hash,status,derivative_status,last_put_expires_at,upload_expires_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, crypto.randomUUID(), crypto.randomUUID(), `event-${event}`, mediaType, mediaType === 'video' ? 'video/mp4' : 'image/jpeg', `staging/${id}`, key, display, thumbnail, 'Our memory.jpg', bytes.byteLength, id, 'intent', 'session', status, mediaType === 'photo' ? 'ready' : 'not_required', new Date().toISOString(), new Date().toISOString(), new Date().toISOString())
    for (const objectKey of [key, display, thumbnail]) if (objectKey) objects.set(objectKey, bytes)
    return { id, key, display, thumbnail }
  }
  function upload(eventSlug: 'solemnisation' | 'reception' = 'solemnisation'): PrepareUploadRequest {
    return { requestId: crypto.randomUUID(), eventSlug, turnstileToken: 'development-bypass', files: [{ clientId: crypto.randomUUID(), filename: 'memory.jpg', mimeType: 'image/jpeg', size: 12, mediaType: 'photo', fingerprint: 'a'.repeat(64), variants: [] }] }
  }
  function prepare(payload: PrepareUploadRequest) { return request('/api/uploads/prepare', { method: 'POST', headers: guestHeaders, body: JSON.stringify(payload) }) }

  it.each([
    ['2027-08-21T15:59:59.999Z', 'solemnisation', ['solemnisation']],
    ['2027-08-21T16:00:00Z', 'reception', ['reception']],
    ['2027-08-22T16:00:00Z', 'both', ['solemnisation', 'reception']],
  ] as const)('exposes only the effective days at %s', async (now, expected, events) => {
    vi.setSystemTime(now)
    const response = await request('/api/gallery/config')
    const config = await data<PublicGalleryConfig>(response)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(config.mode).toBe(expected)
    expect(config.events.map((event) => event.slug)).toEqual(events)
    expect(config.events.every((event) => event.name === 'Our Wedding')).toBe(true)
    expect(config.revision).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(config.revision).not.toMatch(/automatic|manual|solemnisation|reception/)
    expect(Date.parse(config.validUntil) - Date.now()).toBeLessThanOrEqual(30_000)
    if (config.nextTransitionAt) expect(Date.parse(config.validUntil)).toBeLessThanOrEqual(Date.parse(config.nextTransitionAt))
    expect(await data(await request('/api/events'))).toEqual(config.events)
  })

  it('changes opaque public revisions on mode or global upload changes', async () => {
    const first = await data<PublicGalleryConfig>(await request('/api/gallery/config'))
    fixture.database.exec("UPDATE settings SET value='false' WHERE key='uploads_enabled'")
    const closed = await data<PublicGalleryConfig>(await request('/api/gallery/config'))
    expect(closed.revision).not.toBe(first.revision)
    expect(closed.events.every((event) => !event.uploadEnabled)).toBe(true)
    mode('reception')
    expect((await data<PublicGalleryConfig>(await request('/api/gallery/config'))).revision).not.toBe(closed.revision)
  })

  it('filters list, explicit hidden queries, pagination and known deep links without R2 signatures', async () => {
    const visible = seed('solemnisation')
    seed('solemnisation')
    const hidden = seed('reception')
    seed('solemnisation', 'photo', 'pending')
    const page = await data<GalleryPage>(await request('/api/gallery?limit=1'))
    expect(page.items).toHaveLength(1)
    expect(page.items[0].event.slug).toBe('solemnisation')
    expect(page.items[0].displayUrl).toMatch(/^https:\/\/api\.test\/api\/media\/[^/]+\/display$/)
    expect(page.items[0].thumbnailUrl).not.toContain('r2.cloudflarestorage.com')
    expect((await data<GalleryPage>(await request(`/api/gallery?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`))).items.every((item) => item.event.slug === 'solemnisation')).toBe(true)
    expect(await data(await request('/api/gallery?event=reception'))).toEqual({ items: [], nextCursor: null })
    expect((await request(`/api/gallery/${hidden.id}`)).status).toBe(404)
    expect((await request(`/api/gallery/${visible.id}`)).status).toBe(200)
    expect(head).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it.each(['pending', 'rejected', 'deleted', 'uploading'])('denies non-approved %s bytes and detail', async (status) => {
    const media = seed('solemnisation', 'photo', status)
    expect((await request(`/api/gallery/${media.id}`)).status).toBe(404)
    expect((await request(`/api/media/${media.id}/display`)).status).toBe(404)
    expect(head).not.toHaveBeenCalled()
  })

  it.each(['list', 'detail', 'events'] as const)('does not expose the previous day when a %s query spans midnight', async (route) => {
    const media = seed('solemnisation')
    const originalPrepare = fixture.env.DB.prepare.bind(fixture.env.DB)
    vi.spyOn(fixture.env.DB, 'prepare').mockImplementation((sql) => {
      const statement = originalPrepare(sql)
      const matches = route === 'events' ? sql.includes('FROM events ORDER BY event_date') : sql.includes('FROM media m JOIN events')
      if (matches) {
        if (route === 'detail') {
          const first = statement.first.bind(statement)
          vi.spyOn(statement, 'first').mockImplementation(async () => {
            const result = await first()
            vi.setSystemTime('2027-08-21T16:00:00Z')
            return result
          })
        } else {
          const all = statement.all.bind(statement)
          vi.spyOn(statement, 'all').mockImplementation(async () => {
            const result = await all()
            vi.setSystemTime('2027-08-21T16:00:00Z')
            return result
          })
        }
      }
      return statement
    })
    const response = await request(route === 'detail' ? `/api/gallery/${media.id}` : route === 'list' ? '/api/gallery' : '/api/events')
    if (route === 'events') {
      expect(await data(response)).toEqual([expect.objectContaining({ slug: 'reception' })])
    } else {
      expect(response.status).toBe(route === 'list' ? 409 : 404)
      expect(await response.text()).not.toContain(media.id)
    }
  })

  it.each(['GET', 'HEAD'])('rejects hidden %s media before Range, conditional or bucket metadata checks', async (method) => {
    const hidden = seed('reception')
    for (const variant of ['display', 'thumbnail']) {
      const response = await request(`/api/media/${hidden.id}/${variant}`, { method, headers: { Range: 'bytes=0-1', 'If-None-Match': etag, 'If-Modified-Since': 'Wed, 01 Sep 2027 00:00:00 GMT' } })
      expect(response.status).toBe(404)
      expect(response.headers.get('ETag')).toBeNull()
      expect(response.headers.get('Cache-Control')).toContain('no-store')
      if (method === 'HEAD') expect(await response.text()).toBe('')
    }
    expect(head).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it.each([
    [null, 200, '0123456789', null],
    ['bytes=2-5', 206, '2345', 'bytes 2-5/10'],
    ['bytes=7-', 206, '789', 'bytes 7-9/10'],
    ['bytes=-3', 206, '789', 'bytes 7-9/10'],
    ['bytes=8-99', 206, '89', 'bytes 8-9/10'],
    ['bytes=10-', 416, '', 'bytes */10'],
    ['bytes=8-2', 416, '', 'bytes */10'],
    ['bytes=0-1,3-4', 416, '', 'bytes */10'],
  ])('streams visible media with Range=%s', async (range, status, body, contentRange) => {
    const media = seed('solemnisation', 'video')
    const response = await request(`/api/media/${media.id}/display`, { headers: range ? { Range: range } : {} })
    expect(response.status).toBe(status)
    expect(response.headers.get('Content-Range')).toBe(contentRange)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
    expect(await response.text()).toBe(body)
    if (status === 416) expect(get).not.toHaveBeenCalled()
    else expect(response.headers.get('Content-Length')).toBe(String(body.length))
  })

  it('supports HEAD and conditionals only after visibility and approval, with If-Range fallback', async () => {
    const media = seed('solemnisation')
    const path = `/api/media/${media.id}/display`
    const metadata = await request(path, { method: 'HEAD', headers: { Range: 'bytes=0-1' } })
    expect(metadata.status).toBe(200)
    expect(metadata.headers.get('Content-Length')).toBe('10')
    expect(await metadata.text()).toBe('')
    expect((await request(path, { headers: { 'If-None-Match': `W/${etag}` } })).status).toBe(304)
    expect((await request(path, { headers: { 'If-Match': '"other"' } })).status).toBe(412)
    expect((await request(path, { headers: { 'If-Modified-Since': 'Fri, 20 Aug 2027 00:00:00 GMT' } })).status).toBe(304)
    expect(get).not.toHaveBeenCalled()
    const full = await request(path, { headers: { Range: 'bytes=0-1', 'If-Range': '"other"' } })
    expect(full.status).toBe(200)
    expect(await full.text()).toBe('0123456789')
    mode('reception')
    expect((await request(path, { headers: { 'If-None-Match': etag } })).status).toBe(404)
  })

  it('serves a video thumbnail as its image derivative while the display remains video', async () => {
    const media = seed('solemnisation', 'video')
    const thumbnail = `thumbnails/${media.id}.webp`
    fixture.database.prepare('UPDATE media SET thumbnail_object_key=? WHERE id=?').run(thumbnail, media.id)
    objects.set(thumbnail, bytes)
    const response = await request(`/api/media/${media.id}/thumbnail`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(get).toHaveBeenCalledWith(thumbnail, undefined)
    expect((await request(`/api/media/${media.id}/display`)).headers.get('Content-Type')).toBe('video/mp4')
  })

  it('keeps original downloads locked until 23 August and then signs Worker links', async () => {
    const media = seed('solemnisation')
    expect((await request(`/api/gallery/${media.id}/download`)).status).toBe(403)
    expect((await request(`/api/media/${media.id}/original`)).status).toBe(403)
    vi.setSystemTime('2027-08-22T16:00:00Z')
    const link = await data<GalleryDownloadResponse>(await request(`/api/gallery/${media.id}/download`))
    expect(link.expiresInSeconds).toBe(300)
    expect(new URL(link.url).origin).toBe('https://api.test')
    const response = await request(link.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toContain('attachment; filename="Our memory.jpg"')
    expect(await response.text()).toBe('0123456789')
    expect((await request(`/api/media/${media.id}/original`)).status).toBe(404)
    const other = seed('reception')
    expect((await request(link.url.replace(media.id, other.id))).status).toBe(404)
    const altered = new URL(link.url); altered.searchParams.set('expires', String(Number(altered.searchParams.get('expires')) + 1))
    expect((await request(altered.href)).status).toBe(404)
    mode('reception')
    expect((await request(link.url, { headers: { 'If-None-Match': etag } })).status).toBe(404)
    expect((await request(`/api/gallery/${media.id}/download`)).status).toBe(404)
    mode('both')
    vi.advanceTimersByTime(300_000)
    expect((await request(link.url)).status).toBe(404)
  })

  it.each([
    ['HEAD', {}, 'midnight'],
    ['GET', { 'If-None-Match': etag }, 'manual'],
    ['GET', { 'If-Match': '"different"' }, 'rejected'],
    ['GET', { Range: 'bytes=99-' }, 'manual'],
  ] as const)('reauthorizes a %s metadata/conditional response after delayed HEAD (%j, %s)', async (method, headers, change) => {
    const media = seed('solemnisation')
    const original = head.getMockImplementation()!
    let release!: () => void
    const paused = new Promise<void>((resolve) => { release = resolve })
    head.mockImplementationOnce(async (key: string) => { await paused; return original(key) })
    const response = request(`/api/media/${media.id}/display`, { method, headers })
    await vi.waitFor(() => expect(head).toHaveBeenCalled())
    if (change === 'midnight') vi.setSystemTime('2027-08-21T16:00:00Z')
    else if (change === 'rejected') fixture.database.prepare("UPDATE media SET status='rejected' WHERE id=?").run(media.id)
    else mode('reception')
    release()
    const result = await response
    expect(result.status).toBe(404)
    expect(result.headers.get('ETag')).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it.each(['midnight', 'manual', 'deleted', 'expired token'])('reauthorizes and cancels a fetched body after delayed GET (%s)', async (change) => {
    if (change === 'expired token') vi.setSystemTime('2027-08-22T16:00:00Z')
    const media = seed('solemnisation')
    const path = change === 'expired token'
      ? (await data<GalleryDownloadResponse>(await request(`/api/gallery/${media.id}/download`))).url
      : `/api/media/${media.id}/display`
    let release!: () => void
    const paused = new Promise<void>((resolve) => { release = resolve })
    const cancel = vi.fn()
    get.mockImplementationOnce(async () => { await paused; return { body: new ReadableStream({ cancel }) } })
    const response = request(path)
    await vi.waitFor(() => expect(get).toHaveBeenCalled())
    if (change === 'midnight') vi.setSystemTime('2027-08-21T16:00:00Z')
    else if (change === 'manual') mode('reception')
    else if (change === 'deleted') fixture.database.prepare("UPDATE media SET status='deleted' WHERE id=?").run(media.id)
    else vi.advanceTimersByTime(300_000)
    release()
    const result = await response
    expect(result.status).toBe(404)
    expect(result.headers.get('ETag')).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([null, 'not-json', '{}', '{"control":"manual","mode":"both"}'])('fails closed for absent or corrupt settings: %s', async (value) => {
    const media = seed('solemnisation')
    if (value === null) fixture.database.exec("DELETE FROM settings WHERE key='gallery_visibility'")
    else fixture.database.prepare("UPDATE settings SET value=? WHERE key='gallery_visibility'").run(value)
    for (const path of ['/api/gallery/config', '/api/events', '/api/gallery', `/api/gallery/${media.id}`, `/api/media/${media.id}/display`, '/api/live/config']) {
      const response = await request(path)
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toContain('no-store')
    }
    expect(head).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('constrains configured live sources and updates admin visibility exclusively with an audit', async () => {
    fixture.database.exec("UPDATE settings SET value='reception' WHERE key='live_wall_source'")
    expect(await data(await request('/api/live/config'))).toEqual({ source: 'solemnisation' })
    const response = await admin('/api/admin/settings', 'PATCH', { visibility: { control: 'manual', mode: 'both' } })
    const settings = await data<GallerySettings>(response)
    expect(settings.visibility).toMatchObject({ control: 'manual', effectiveMode: 'both', lastSingleDay: 'solemnisation', overrideUntil: '2027-08-22T00:00:00+08:00' })
    expect(fixture.database.prepare("SELECT action FROM audit_log WHERE action='settings_update'").all()).toHaveLength(1)
    expect(await data(await request('/api/live/config'))).toEqual({ source: 'reception' })
    vi.setSystemTime('2027-08-21T16:00:00Z')
    expect((await data<GallerySettings>(await admin())).visibility).toMatchObject({ control: 'automatic', effectiveMode: 'reception' })
    await admin('/api/admin/settings', 'PATCH', { visibility: { control: 'manual', mode: 'both' } })
    expect((await data<GallerySettings>(await admin())).visibility.lastSingleDay).toBe('reception')
    vi.setSystemTime('2027-08-22T16:00:00Z')
    expect((await data<GallerySettings>(await admin())).visibility).toMatchObject({ control: 'automatic', effectiveMode: 'both' })
  })

  it.each([null, [], { event: { slug: 'reception', uploadEnabled: false } }, { uploadsEnabled: 'true' },
    { visibility: { control: 'manual', mode: 'all' } }, { visibility: { control: 'manual', mode: 'both', overrideUntil: null } },
    { visibility: { control: 'automatic', mode: 'both' } }])('rejects invalid or legacy setting mutations: %j', async (payload) => {
    const before = fixture.database.prepare('SELECT * FROM settings ORDER BY key').all()
    expect((await admin('/api/admin/settings', 'PATCH', payload)).status).toBe(400)
    expect(fixture.database.prepare('SELECT * FROM settings ORDER BY key').all()).toEqual(before)
    expect(fixture.database.prepare("SELECT * FROM audit_log WHERE action='settings_update'").all()).toHaveLength(0)
  })

  it('requires admin and the exact origin to change day access', async () => {
    const body = JSON.stringify({ visibility: { control: 'manual', mode: 'both' } })
    expect((await request('/api/admin/settings', { method: 'PATCH', headers: guestHeaders, body })).status).toBe(401)
    const session = await createAdminSession(fixture.env)
    expect((await request('/api/admin/settings', { method: 'PATCH', headers: { ...guestHeaders, Origin: 'https://other.test', Cookie: session.cookie.split(';')[0] }, body })).status).toBe(403)
  })

  it('uses global plus visible day for new uploads while preserving old per-day flags', async () => {
    fixture.database.exec("UPDATE events SET upload_enabled=0 WHERE slug='solemnisation'")
    const config = await data<PublicGalleryConfig>(await request('/api/gallery/config'))
    expect(config.events[0].uploadEnabled).toBe(true)
    expect((await prepare(upload('solemnisation'))).status).toBe(201)
    expect((await prepare(upload('reception'))).status).toBe(403)
    fixture.database.exec("UPDATE settings SET value='false' WHERE key='uploads_enabled'")
    expect((await prepare(upload())).status).toBe(403)
    expect(fixture.database.prepare("SELECT upload_enabled FROM events WHERE slug='solemnisation'").get()).toMatchObject({ upload_enabled: 0 })
  })

  it('allows authorized retries, refresh and completion for the original hidden day after global closure', async () => {
    const payload = upload()
    const initialResponse = await prepare(payload)
    expect(initialResponse.headers.get('Cache-Control')).toBe('no-store')
    const prepared = await data<PrepareUploadResponse>(initialResponse)
    const id = prepared.uploads[0].mediaId
    mode('reception')
    fixture.database.exec("UPDATE settings SET value='false' WHERE key='uploads_enabled'")
    const retry = await data<PrepareUploadResponse>(await prepare({ ...payload, turnstileToken: '' }))
    expect(retry.uploads[0].mediaId).toBe(id)
    const refreshed = await request(`/api/uploads/${id}/refresh`, { method: 'POST', headers: guestHeaders, body: '{}' })
    expect(refreshed.status).toBe(200)
    expect(refreshed.headers.get('Cache-Control')).toBe('no-store')
    const row = fixture.database.prepare('SELECT original_object_key,event_id FROM media WHERE id=?').get(id)!
    objects.set(String(row.original_object_key), new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    const complete = await request(`/api/uploads/${id}/complete`, { method: 'POST', headers: guestHeaders, body: JSON.stringify({ uploadedVariants: [], derivativeStatus: 'unavailable' }) })
    expect(complete.status).toBe(200)
    expect(await data(complete)).toEqual({ mediaId: id, status: 'pending' })
    expect(fixture.database.prepare('SELECT event_id,status FROM media WHERE id=?').get(id)).toMatchObject({ event_id: 'event-solemnisation', status: 'pending' })
    expect((await request(`/api/gallery/${id}`)).status).toBe(404)
    expect((await request(`/api/uploads/${id}/complete`, { method: 'POST', headers: guestHeaders, body: JSON.stringify({ uploadedVariants: [] }) })).status).toBe(200)
  })

  it.each(['midnight', 'manual switch', 'global closure'])('rechecks new upload authority after Turnstile spans a %s', async (change) => {
    fixture.env.TURNSTILE_BYPASS = 'false'
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (change === 'midnight') vi.setSystemTime('2027-08-21T16:00:00Z')
      else if (change === 'manual switch') mode('reception')
      else fixture.database.exec("UPDATE settings SET value='false' WHERE key='uploads_enabled'")
      return new Response(JSON.stringify({ success: true, hostname: 'localhost', action: 'upload_prepare' }))
    }))
    const response = await prepare({ ...upload(), turnstileToken: 'single-use-token' })
    expect(response.status).toBe(403)
    expect(fixture.database.prepare('SELECT COUNT(*) AS total FROM media').get()).toEqual({ total: 0 })
    expect(fixture.database.prepare('SELECT COUNT(*) AS total FROM upload_requests').get()).toEqual({ total: 0 })
  })

  it.each(['expiry', 'completion'])('does not refresh a PUT when slow bucket validation spans %s', async (change) => {
    const prepared = await data<PrepareUploadResponse>(await prepare(upload()))
    const id = prepared.uploads[0].mediaId
    const row = fixture.database.prepare('SELECT upload_expires_at,last_put_expires_at FROM media WHERE id=?').get(id)!
    vi.setSystemTime(Date.parse(String(row.upload_expires_at)) - 20_000)
    head.mockImplementationOnce(async () => {
      if (change === 'expiry') vi.setSystemTime(String(row.upload_expires_at))
      else fixture.database.prepare("UPDATE media SET status='pending' WHERE id=?").run(id)
      return null
    })
    const response = await request(`/api/uploads/${id}/refresh`, { method: 'POST', headers: guestHeaders, body: '{}' })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: change === 'expiry' ? 'UPLOAD_AUTHORIZATION_EXPIRED' : 'INVALID_UPLOAD_STATE' } })
    expect(fixture.database.prepare('SELECT last_put_expires_at FROM media WHERE id=?').get(id)).toEqual({ last_put_expires_at: row.last_put_expires_at })
  })
})

describe('visibility migration compatibility on real SQLite', () => {
  it('preserves media, event associations, upload flags, settings and download configuration', () => {
    const fixture = sqliteEnv(3)
    try {
      fixture.database.exec(readFileSync(resolve('worker/seeds/development.sql'), 'utf8'))
      fixture.database.exec("UPDATE events SET upload_enabled=0 WHERE slug='reception'")
      const before = fixture.database.prepare('SELECT * FROM media ORDER BY id').all()
      const associations = fixture.database.prepare('SELECT id,slug,event_date,upload_enabled FROM events ORDER BY id').all()
      const settings = fixture.database.prepare('SELECT * FROM settings ORDER BY key').all()
      fixture.applyMigration('0004_gallery_visibility.sql')
      expect(fixture.database.prepare('SELECT * FROM media ORDER BY id').all()).toEqual(before)
      expect(fixture.database.prepare('SELECT id,slug,event_date,upload_enabled FROM events ORDER BY id').all()).toEqual(associations)
      expect(fixture.database.prepare("SELECT * FROM settings WHERE key!='gallery_visibility' ORDER BY key").all()).toEqual(settings)
      expect(fixture.database.prepare('SELECT display_name FROM events ORDER BY event_date').all()).toEqual([{ display_name: 'Our Wedding · 21 August' }, { display_name: 'Our Wedding · 22 August' }])
      expect(fixture.database.prepare('SELECT DISTINCT name FROM events').all()).toEqual([{ name: 'Our Wedding' }])
      const stored = fixture.database.prepare("SELECT value FROM settings WHERE key='gallery_visibility'").get()!
      expect(JSON.parse(String(stored.value))).toEqual({ control: 'manual', mode: 'both', lastSingleDay: 'solemnisation', overrideUntil: null })
      expect(fixture.env.DOWNLOADS_AVAILABLE_AT).toBe('2027-08-23T00:00:00+08:00')
      expect(fixture.database.prepare('SELECT count(*) AS rows,sum(size_bytes) AS original_bytes FROM media').get()).toEqual({ rows: 3, original_bytes: 103389594 })
    } finally { fixture.close() }
  })
})
