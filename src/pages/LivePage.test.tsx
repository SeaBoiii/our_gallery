import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import type { GalleryMedia, GalleryPage } from '../../shared/contracts'
import { LocaleProvider } from '../context/LocaleContext'
import { mockGallery } from '../data/mock'
import { publicConfig, TestVisibilityProvider } from '../test/visibility'
import LivePage from './LivePage'
import { PUBLIC_GALLERY_URL } from '../config'

const api = vi.hoisted(() => ({ getGallery: vi.fn(), getLiveConfig: vi.fn() }))
vi.mock('../services/api', () => api)
const tree = (mode: 'both' | 'solemnisation' | 'reception' | null) => <LocaleProvider><TestVisibilityProvider config={mode ? publicConfig({ mode }) : null}><LivePage /></TestVisibilityProvider></LocaleProvider>

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'fullscreenElement')
  Reflect.deleteProperty(document, 'exitFullscreen')
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
  window.history.replaceState(null, '', '/')
  document.getElementById('live-fit-test-style')?.remove()
})

describe('live wall visibility', () => {
  beforeEach(() => { api.getGallery.mockReset(); api.getLiveConfig.mockReset() })

  it('intersects a configured hidden source with the visible day and suppresses hidden media and date controls', async () => {
    api.getLiveConfig.mockResolvedValue({ source: 'reception' })
    api.getGallery.mockResolvedValue({ items: [mockGallery[0], mockGallery[2]], nextCursor: null })
    render(tree('solemnisation'))
    expect(await screen.findByRole('img', { name: mockGallery[0].guestMessage! })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: mockGallery[2].guestMessage! })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '22 August' })).not.toBeInTheDocument()
    expect(api.getGallery).toHaveBeenLastCalledWith({ event: 'solemnisation', limit: 50 })
  })

  it('clears an existing live image and rejects a late old-policy page after visibility fails', async () => {
    let resolve!: (page: GalleryPage) => void
    api.getLiveConfig.mockResolvedValue({ source: 'all' })
    api.getGallery.mockReturnValue(new Promise<GalleryPage>(done => { resolve = done }))
    const view = render(tree('both'))
    await waitFor(() => expect(api.getGallery).toHaveBeenCalled())
    view.rerender(tree(null))
    await act(async () => resolve({ items: [mockGallery[2]], nextCursor: null }))
    expect(screen.getByRole('alert')).toHaveTextContent('The gallery is temporarily unavailable')
    expect(document.querySelector('.live-media')).not.toBeInTheDocument()
    expect(screen.queryByText(/22 August/)).not.toBeInTheDocument()
  })

  it('clears media when live-source refresh fails', async () => {
    let reject!: (error: Error) => void
    api.getLiveConfig.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    api.getGallery.mockResolvedValue({ items: [mockGallery[0]], nextCursor: null })
    render(tree('both'))
    expect(await screen.findByRole('img', { name: mockGallery[0].guestMessage! })).toBeInTheDocument()
    await act(async () => reject(new Error('offline')))
    expect(document.querySelector('.live-media')).not.toBeInTheDocument()
    expect(screen.getAllByText('Reconnecting…').length).toBeGreaterThan(0)
  })
})

describe('live wall presentation and controls', () => {
  beforeEach(() => {
    api.getGallery.mockReset().mockResolvedValue({ items: [mockGallery[0]], nextCursor: null })
    api.getLiveConfig.mockReset().mockResolvedValue({ source: 'all' })
  })

  it('keeps the date-aware wedding identity, labelled QR, and all controls available in Malay', async () => {
    render(tree('solemnisation'))
    await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Aleem & Nurulain')
    expect(document.querySelector('.live-date')).toHaveTextContent('21 August 2027')
    fireEvent.click(screen.getByRole('button', { name: 'Tukar ke Bahasa Melayu' }))
    expect(screen.getByRole('button', { name: 'Jeda tayangan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Masuk skrin penuh' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Kod QR untuk berkongsi kenangan perkahwinan' })).toBeInTheDocument()
    expect(document.querySelector('.live-date')).toHaveTextContent('21 Ogos 2027')
    expect(screen.queryByRole('button', { name: '22 Ogos' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Kapsyen kenangan' })).toHaveAttribute('tabindex', '0')
  })

  it('keeps the current photo during pause and polling, then resumes preloaded rotation', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.stubGlobal('Image', class { complete = true; naturalWidth = 1200; src = ''; onload = null; onerror = null })
    api.getGallery.mockResolvedValue({ items: [mockGallery[0], mockGallery[1]], nextCursor: null })
    render(tree('solemnisation'))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('img', { name: mockGallery[0].guestMessage! })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    await act(async () => vi.advanceTimersByTimeAsync(25_000))
    expect(api.getGallery).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('img', { name: mockGallery[0].guestMessage! })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Slideshow paused')
    fireEvent.click(screen.getByRole('button', { name: 'Resume slideshow' }))
    await act(async () => vi.advanceTimersByTimeAsync(9_000))
    expect(screen.getByRole('img', { name: mockGallery[1].guestMessage! })).toBeInTheDocument()
  })

  it('starts with motion paused for reduced-motion guests and lets them explicitly play a video', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    api.getGallery.mockResolvedValue({ items: [mockGallery[3]], nextCursor: null })
    render(tree('reception'))
    await waitFor(() => expect(document.querySelector('.live-media video')).toBeInTheDocument())
    expect(document.querySelector('.live-media video')).not.toHaveAttribute('autoplay')
    expect(screen.getByRole('button', { name: 'Resume slideshow' })).toBeInTheDocument()
    expect(pause).toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Resume slideshow' }))
    expect(play).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('reports fullscreen failure without losing the image and supports a later enter and exit', async () => {
    let fullscreenElement: Element | null = null
    const requestFullscreen = vi.fn().mockRejectedValueOnce(new Error('Permission denied')).mockImplementation(async () => {
      fullscreenElement = document.documentElement
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    render(tree('solemnisation'))
    await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Fullscreen could not be opened')
    expect(screen.getByRole('img', { name: mockGallery[0].guestMessage! })).toBeInTheDocument()
    expect(screen.getByRole('alert').closest('header')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Exit fullscreen' }))
    await screen.findByRole('button', { name: 'Enter fullscreen' })
    expect(exitFullscreen).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('filters media to the selected source even if a page contains another visible day', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    api.getGallery.mockResolvedValue({ items: [mockGallery[0], mockGallery[2]], nextCursor: null })
    render(tree('both'))
    await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    fireEvent.click(screen.getByRole('button', { name: '22 August' }))
    expect(await screen.findByRole('img', { name: mockGallery[2].guestMessage! })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: mockGallery[0].guestMessage! })).not.toBeInTheDocument()
    expect(api.getGallery).toHaveBeenLastCalledWith({ event: 'reception', limit: 50 })
  })
})

describe('live travel journal layouts', () => {
  const photo = (id: string, day: 'solemnisation' | 'reception' = 'solemnisation'): GalleryMedia => ({
    ...mockGallery[0], id, event: mockGallery[day === 'solemnisation' ? 0 : 2].event,
    guestMessage: `A memory named ${id}`, displayUrl: `/display/${id}.webp`, thumbnailUrl: `/thumbnail/${id}.webp`,
  })
  const first = photo('first')
  const second = photo('second')
  const third = photo('third')
  const newest = photo('newest')
  const receptionFirst = photo('reception-first', 'reception')
  const receptionSecond = photo('reception-second', 'reception')
  const scraps = () => Array.from(document.querySelectorAll<HTMLImageElement>('.live-scrap img'))
  const scrapUrls = () => scraps().map(image => image.getAttribute('src'))
  const tick = async (milliseconds = 0) => { await act(async () => vi.advanceTimersByTimeAsync(milliseconds)) }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.stubGlobal('Image', class { complete = true; naturalWidth = 1200; src = ''; onload = null; onerror = null })
    api.getGallery.mockReset().mockResolvedValue({ items: [first, second, third], nextCursor: null })
    api.getLiveConfig.mockReset().mockResolvedValue({ source: 'all' })
  })

  it('visits six distinct layouts only when the slideshow advances and then wraps to the first', async () => {
    render(tree('solemnisation'))
    await tick()
    const wall = screen.getByRole('main')
    expect(wall).toHaveClass('live-layout-0')
    for (let advance = 1; advance <= 6; advance += 1) {
      const previousLayout = `live-layout-${(advance - 1) % 6}`
      const previousPhoto = document.querySelector('.live-media img')!.getAttribute('src')
      // A gallery poll can refresh the preload timer, so follow the real pending
      // timers until the next advance instead of assuming a fixed polling phase.
      for (let timer = 0; timer < 5 && wall.classList.contains(previousLayout); timer += 1) {
        await act(async () => vi.advanceTimersToNextTimerAsync())
      }
      expect(wall).toHaveClass(`live-layout-${advance % 6}`)
      expect(document.querySelector('.live-media img')).not.toHaveAttribute('src', previousPhoto)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    await tick(40_000)
    expect(wall).toHaveClass('live-layout-0')
  })

  it('freezes companion identities and order while paused even when polling inserts and reorders photos', async () => {
    render(tree('solemnisation'))
    await tick()
    expect(scrapUrls()).toEqual([second.thumbnailUrl, third.thumbnailUrl])
    const originalScraps = scraps()
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    api.getGallery.mockResolvedValue({ items: [newest, { ...first }, { ...third }, { ...second }], nextCursor: null })
    await tick(20_000)
    expect(document.querySelector('.live-media img')).toHaveAttribute('src', first.displayUrl)
    expect(scrapUrls()).toEqual([second.thumbnailUrl, third.thumbnailUrl])
    expect(scraps()[0]).toBe(originalScraps[0])
    expect(scraps()[1]).toBe(originalScraps[1])
    expect(screen.getByRole('main')).toHaveClass('live-layout-0')
    for (const image of scraps()) {
      expect(image).toHaveAttribute('alt', '')
      expect(image.closest('.live-scrap')).toHaveAttribute('aria-hidden', 'true')
    }
    expect(within(screen.getByRole('region', { name: 'The live memory wall' })).getAllByRole('img')).toHaveLength(1)
  })

  it('removes revoked companions on a paused refresh without filling their places with new photos', async () => {
    render(tree('solemnisation'))
    await tick()
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    api.getGallery.mockResolvedValue({ items: [first, third, newest], nextCursor: null })
    await tick(20_000)
    expect(scrapUrls()).toEqual([third.thumbnailUrl])
    expect(scrapUrls()).not.toContain(newest.thumbnailUrl)
    api.getGallery.mockResolvedValue({ items: [first, newest], nextCursor: null })
    await tick(20_000)
    expect(scraps()).toHaveLength(0)
    expect(document.querySelector('.live-media img')).toHaveAttribute('src', first.displayUrl)
    expect(screen.getByRole('button', { name: 'Resume slideshow' })).toBeInTheDocument()
  })

  it('clears companion photos immediately on day-policy changes and when visibility becomes unavailable', async () => {
    api.getGallery.mockResolvedValue({ items: [first, second, receptionFirst], nextCursor: null })
    const view = render(tree('both'))
    await tick()
    expect(scrapUrls()).toContain(second.thumbnailUrl)
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    api.getGallery.mockResolvedValue({ items: [first, second, receptionFirst, receptionSecond], nextCursor: null })
    view.rerender(tree('reception'))
    expect(scraps()).toHaveLength(0)
    expect(document.querySelector('.live-media')).not.toBeInTheDocument()
    await tick()
    expect(document.querySelector('.live-media img')).toHaveAttribute('src', receptionFirst.displayUrl)
    expect(scrapUrls()).toEqual([receptionSecond.thumbnailUrl])
    view.rerender(tree(null))
    expect(scraps()).toHaveLength(0)
    expect(document.querySelector('.live-media')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The gallery is temporarily unavailable')
  })

  it('clears companions on a source switch and ignores a late response from the previous source', async () => {
    api.getGallery.mockResolvedValue({ items: [first, second, receptionFirst, receptionSecond], nextCursor: null })
    render(tree('both'))
    await tick()
    expect(scrapUrls()).toContain(second.thumbnailUrl)
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    let resolveOldPage!: (page: GalleryPage) => void
    api.getGallery.mockReturnValueOnce(new Promise<GalleryPage>(resolve => { resolveOldPage = resolve }))
    await tick(20_000)
    fireEvent.click(screen.getByRole('button', { name: '22 August' }))
    expect(scraps()).toHaveLength(0)
    await tick()
    expect(scrapUrls()).toEqual([receptionSecond.thumbnailUrl])
    expect(document.querySelector('.live-media img')).toHaveAttribute('src', receptionFirst.displayUrl)
    await act(async () => resolveOldPage({ items: [first, second, third], nextCursor: null }))
    expect(scrapUrls()).toEqual([receptionSecond.thumbnailUrl])
    expect(document.querySelector('.live-media img')).toHaveAttribute('src', receptionFirst.displayUrl)
  })

  it('uses only thumbnail photos for companions and never creates an extra video player', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const mainVideo = { ...mockGallery[3], id: 'main-video' }
    const otherVideo = { ...mockGallery[7], id: 'other-video' }
    api.getGallery.mockResolvedValue({ items: [mainVideo, first, otherVideo, second, third], nextCursor: null })
    render(tree('both'))
    await tick()
    expect(document.querySelectorAll('video')).toHaveLength(1)
    expect(document.querySelector('.live-media video')).toHaveAttribute('src', mainVideo.displayUrl)
    expect(scrapUrls()).toEqual([first.thumbnailUrl, second.thumbnailUrl])
    expect(document.querySelector('.live-scrap video')).not.toBeInTheDocument()
    expect(scrapUrls()).not.toContain(first.displayUrl)
  })

  it('shows a single approved photo once without companion duplicates or layout advances during polling', async () => {
    api.getGallery.mockResolvedValue({ items: [first], nextCursor: null })
    render(tree('solemnisation'))
    await tick()
    expect(scraps()).toHaveLength(0)
    await tick(60_000)
    expect(document.querySelectorAll('.live-media img')).toHaveLength(1)
    expect(document.querySelector('.live-media img')).toHaveAttribute('src', first.displayUrl)
    expect(scraps()).toHaveLength(0)
    expect(screen.getByRole('main')).toHaveClass('live-layout-0')
  })
})

describe('live QR placement', () => {
  beforeEach(() => {
    api.getGallery.mockReset().mockResolvedValue({ items: [mockGallery[0]], nextCursor: null })
    api.getLiveConfig.mockReset().mockResolvedValue({ source: 'all' })
  })

  it.each([
    ['', 'right'], ['?qr=right', 'right'], ['?qr=', 'right'], ['?qr=invalid', 'right'], ['?qr=LEFT', 'right'], ['?qr=left', 'left'],
  ])('uses the requested rail and matching reading order for %s', async (query, side) => {
    window.history.replaceState(null, '', `/live${query}`)
    render(tree('solemnisation'))
    await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    const stage = document.querySelector('.live-stage')!
    const qr = screen.getByRole('complementary')
    expect(stage).toHaveAttribute('data-qr-side', side)
    expect(side === 'left' ? stage.firstElementChild : stage.lastElementChild).toBe(qr)
  })

  it('keeps the gallery destination encoded in a left QR instead of encoding the live-wall options', async () => {
    const expected = render(<QRCodeSVG value={PUBLIC_GALLERY_URL} size={192} level="H" marginSize={4} />)
    const expectedCode = expected.container.querySelector('path:last-of-type')!.getAttribute('d')
    expected.unmount()
    window.history.replaceState(null, '', '/live?qr=left')
    render(tree('solemnisation'))
    await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    expect(document.querySelector('.live-qr-code path:last-of-type')).toHaveAttribute('d', expectedCode)
    expect(screen.getByRole('link', { name: 'gallery.aleemxnurul.love' })).toHaveAttribute('href', PUBLIC_GALLERY_URL)
  })

  it('updates on router query navigation without resetting the paused slideshow', async () => {
    function ChangeRail() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/live?qr=right')}>Move QR right</button>
    }
    render(<MemoryRouter initialEntries={['/live?qr=left']}>{tree('solemnisation')}<ChangeRail /></MemoryRouter>)
    const photo = await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move QR right' }))
    expect(document.querySelector('.live-stage')).toHaveAttribute('data-qr-side', 'right')
    expect(screen.getByRole('img', { name: mockGallery[0].guestMessage! })).toBe(photo)
    expect(screen.getByRole('button', { name: 'Resume slideshow' })).toBeInTheDocument()
  })

  it('responds to standalone browser back/forward query changes without a router', async () => {
    render(tree('solemnisation'))
    await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    window.history.replaceState(null, '', '/live?qr=left')
    fireEvent.popState(window)
    expect(document.querySelector('.live-stage')).toHaveAttribute('data-qr-side', 'left')
  })
})

describe('live print measurement', () => {
  let slotWidth: number
  let captionHeight: number
  let observers: Array<{ notify: () => void; disconnect: ReturnType<typeof vi.fn> }>

  beforeEach(() => {
    slotWidth = 500
    captionHeight = 24
    observers = []
    const getRect = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (!this.matches('.live-photo-slot,.live-scrap-slot')) return getRect.call(this)
      const width = this.matches('.live-photo-slot') ? slotWidth : 210
      const height = this.matches('.live-photo-slot') ? 380 : 160
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({ width, height }) }
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.tagName === 'FIGCAPTION' ? captionHeight : 0 })
    vi.stubGlobal('ResizeObserver', class {
      disconnect = vi.fn()
      observe = vi.fn()
      constructor(callback: ResizeObserverCallback) { observers.push({ notify: () => callback([], this as unknown as ResizeObserver), disconnect: this.disconnect }) }
    })
    const style = document.createElement('style')
    style.id = 'live-fit-test-style'
    style.textContent = '.live-media,.live-scrap { padding:10px; border:1px solid; rotate:0deg; }'
    document.head.append(style)
    api.getGallery.mockReset().mockResolvedValue({ items: [mockGallery[0]], nextCursor: null })
    api.getLiveConfig.mockReset().mockResolvedValue({ source: 'all' })
  })

  const frameRatio = (frame: HTMLElement) => (Number.parseFloat(frame.style.width) - 22) / (Number.parseFloat(frame.style.height) - 22 - captionHeight)

  it('fits metadata first, then hugs the actual decoded aspect instead of retaining a portrait mat', async () => {
    render(tree('solemnisation'))
    const photo = await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    const frame = photo.closest('figure')!
    expect(frameRatio(frame)).toBeCloseTo(mockGallery[0].width! / mockGallery[0].height!)
    expect(Number.parseFloat(frame.style.height)).toBeCloseTo(380)
    Object.defineProperties(photo, { naturalWidth: { configurable: true, value: 1800 }, naturalHeight: { configurable: true, value: 900 } })
    fireEvent.load(photo)
    expect(frameRatio(frame)).toBeCloseTo(2)
    expect(Number.parseFloat(frame.style.width)).toBeCloseTo(500)
    expect(Number.parseFloat(frame.style.height)).toBeLessThan(300)
  })

  it('measures an image with missing metadata after load and disconnects observers on revocation', async () => {
    api.getGallery.mockResolvedValue({ items: [{ ...mockGallery[0], width: null, height: null }], nextCursor: null })
    const view = render(tree('solemnisation'))
    const photo = await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    expect(photo.closest('figure')).toHaveAttribute('data-fitted', 'false')
    Object.defineProperties(photo, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 1200 } })
    fireEvent.load(photo)
    expect(frameRatio(photo.closest('figure')!)).toBeCloseTo(1)
    view.rerender(tree(null))
    expect(observers.length).toBeGreaterThan(0)
    expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true)
  })

  it('fits companions to their actual thumbnail ratio as well as the main print', async () => {
    api.getGallery.mockResolvedValue({ items: [mockGallery[0], mockGallery[1]], nextCursor: null })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(tree('solemnisation'))
    await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    const photo = document.querySelector<HTMLImageElement>('.live-scrap img')!
    Object.defineProperties(photo, { naturalWidth: { configurable: true, value: 300 }, naturalHeight: { configurable: true, value: 900 } })
    fireEvent.load(photo)
    const frame = photo.closest('figure')!
    expect(frameRatio(frame)).toBeCloseTo(1 / 3)
    expect(Number.parseFloat(frame.style.height)).toBeLessThanOrEqual(160)
    expect(Number.parseFloat(frame.style.width)).toBeLessThan(70)
  })

  it('recalculates after caption and viewport changes and can grow a mobile flow slot again', async () => {
    document.getElementById('live-fit-test-style')!.textContent += '.live-photo-slot { --print-flow:1; max-height:420px; }'
    api.getGallery.mockResolvedValue({ items: [{ ...mockGallery[0], width: 1800, height: 900 }], nextCursor: null })
    render(tree('solemnisation'))
    const photo = await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    const frame = photo.closest('figure')!
    const firstHeight = Number.parseFloat(frame.style.height)
    slotWidth = 280
    act(() => { for (const observer of observers) observer.notify() })
    expect(Number.parseFloat(frame.style.height)).toBeLessThan(firstHeight)
    slotWidth = 600
    captionHeight = 36
    act(() => { for (const observer of observers) observer.notify() })
    expect(Number.parseFloat(frame.style.width)).toBeCloseTo(600)
    expect(Number.parseFloat(frame.style.height)).toBeGreaterThan(firstHeight)
    expect(frameRatio(frame)).toBeCloseTo(2)
  })
})
