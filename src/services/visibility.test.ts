import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ API_BASE_URL: 'https://api.example.test', USE_MOCK_DATA: true }))
vi.mock('../config', () => config)

describe('gallery policy API and development state', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2027-08-21T04:00:00Z')); config.USE_MOCK_DATA = true })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('applies admin day changes consistently to config, gallery, details and live while retaining all admin media', async () => {
    const api = await import('./api')
    const adminBefore = await api.getAdminMedia()
    const first = await api.getGalleryConfig()
    expect(first.mode).toBe('solemnisation')
    expect(first.events.map(event => event.slug)).toEqual(['solemnisation'])
    expect((await api.getGallery()).items.every(item => item.event.slug === 'solemnisation')).toBe(true)
    await expect(api.getGalleryMedia('memory-3')).rejects.toMatchObject({ code: 'MEDIA_NOT_FOUND' })
    await api.updateAdminSettings({ visibility: { control: 'manual', mode: 'reception' } })
    expect((await api.getGalleryConfig()).revision).not.toBe(first.revision)
    expect((await api.getEvents()).map(event => event.slug)).toEqual(['reception'])
    expect((await api.getGallery()).items.every(item => item.event.slug === 'reception')).toBe(true)
    await expect(api.getMediaDownload('memory-1')).rejects.toMatchObject({ code: 'MEDIA_NOT_FOUND' })
    expect(await api.getLiveConfig()).toEqual({ source: 'reception' })
    expect(await api.getAdminMedia()).toEqual(adminBefore)
    await api.updateAdminSettings({ visibility: { control: 'manual', mode: 'both' } })
    expect((await api.getGallery()).items.some(item => item.event.slug === 'solemnisation')).toBe(true)
    expect((await api.getAdminSettings()).visibility.lastSingleDay).toBe('reception')
  })

  it('expires manual overrides at Singapore midnight and treats uploads as one independent global gate', async () => {
    const api = await import('./api')
    await api.updateAdminSettings({ visibility: { control: 'manual', mode: 'both' }, uploadsEnabled: false })
    expect((await api.getGalleryConfig()).events.every(event => !event.uploadEnabled)).toBe(true)
    expect((await api.getGallery()).items.length).toBeGreaterThan(0)
    vi.setSystemTime(new Date('2027-08-21T16:00:00Z'))
    expect((await api.getGalleryConfig()).mode).toBe('reception')
    expect((await api.getAdminSettings()).visibility.control).toBe('automatic')
    vi.setSystemTime(new Date('2027-08-22T16:00:00Z'))
    expect((await api.getGalleryConfig()).mode).toBe('both')
  })

  it('fetches production config without caching or development fallback', async () => {
    config.USE_MOCK_DATA = false
    const fetch = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetch)
    const api = await import('./api')
    await expect(api.getGalleryConfig()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('https://api.example.test/api/gallery/config', expect.objectContaining({ cache: 'no-store', credentials: 'include' }))
  })
})
