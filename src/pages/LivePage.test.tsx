import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('starts paused for reduced-motion guests, skips videos and never creates a video player', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    api.getGallery.mockResolvedValue({ items: [mockGallery[3], { ...mockGallery[3], id: 'legacy-video', mediaType: 'video', mimeType: 'video/mp4' }, mockGallery[0]], nextCursor: null })
    render(tree('both'))
    expect(await screen.findByRole('button', { name: 'Resume slideshow' })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.live-media img')).toBeInTheDocument())
    expect(document.querySelector('video')).not.toBeInTheDocument()
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

describe('live arrivals hall', () => {
  const photo = (id: string, day: 'solemnisation' | 'reception' = 'solemnisation', createdAt = '2027-08-21T10:00:00.000Z'): GalleryMedia => ({
    ...mockGallery[0], id, event: mockGallery[day === 'solemnisation' ? 0 : 2].event, createdAt,
    guestMessage: `A memory named ${id}`, displayUrl: `/display/${id}.webp`, thumbnailUrl: `/thumbnail/${id}.webp`,
  })
  const first = photo('first', 'solemnisation', '2027-08-21T10:00:00.000Z')
  const second = photo('second', 'solemnisation', '2027-08-21T11:00:00.000Z')
  const third = photo('third', 'solemnisation', '2027-08-21T12:00:00.000Z')
  const newest = photo('newest', 'solemnisation', '2027-08-21T13:00:00.000Z')
  const receptionFirst = photo('reception-first', 'reception')
  const mainPhoto = () => document.querySelector('.live-media img')?.getAttribute('src')
  const tick = async (milliseconds = 0) => { await act(async () => vi.advanceTimersByTimeAsync(milliseconds)) }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.stubGlobal('Image', class { complete = true; naturalWidth = 1200; src = ''; onload = null; onerror = null })
    api.getGallery.mockReset().mockResolvedValue({ items: [first, second, third], nextCursor: null })
    api.getLiveConfig.mockReset().mockResolvedValue({ source: 'all' })
  })

  it('shows a photograph approved since the last poll next, marked as just landed', async () => {
    render(tree('solemnisation'))
    await tick()
    expect(mainPhoto()).toBe(first.displayUrl)
    expect(screen.queryByText('Just landed')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    api.getGallery.mockResolvedValue({ items: [newest, first, second, third], nextCursor: null })
    await tick(20_000)
    expect(mainPhoto()).toBe(first.displayUrl)
    fireEvent.click(screen.getByRole('button', { name: 'Resume slideshow' }))
    await tick(9_000)
    expect(mainPhoto()).toBe(newest.displayUrl)
    expect(screen.getByText('Just landed')).toBeInTheDocument()
    await tick(9_000)
    expect(mainPhoto()).not.toBe(newest.displayUrl)
    expect(screen.queryByText('Just landed')).not.toBeInTheDocument()
  })

  it('numbers each print, counts the memories and keeps the last two prints on the pile', async () => {
    const pile = () => Array.from(document.querySelectorAll<HTMLImageElement>('.live-pile-print img')).map(image => image.getAttribute('src'))
    render(tree('solemnisation'))
    await tick()
    expect(screen.getByText('3 memories have landed')).toBeInTheDocument()
    expect(document.querySelector('.live-print-number')).toHaveTextContent('Memory Nº 001')
    expect(pile()).toEqual([])
    await tick(9_000)
    expect(mainPhoto()).toBe(second.displayUrl)
    expect(document.querySelector('.live-print-number')).toHaveTextContent('Memory Nº 002')
    expect(pile()).toEqual([first.thumbnailUrl])
    expect(document.querySelector('.live-pile')).toHaveAttribute('aria-hidden', 'true')
    await tick(9_000)
    expect(mainPhoto()).toBe(third.displayUrl)
    expect(pile()).toEqual([second.thumbnailUrl, first.thumbnailUrl])
  })

  it('drops revoked photos from the pile on the next refresh', async () => {
    render(tree('solemnisation'))
    await tick()
    await tick(9_000)
    expect(document.querySelectorAll('.live-pile-print')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    api.getGallery.mockResolvedValue({ items: [second, third], nextCursor: null })
    await tick(20_000)
    expect(mainPhoto()).toBe(second.displayUrl)
    expect(document.querySelectorAll('.live-pile-print')).toHaveLength(0)
  })

  it('hides the cursor and controls after three idle seconds and wakes on pointer movement', async () => {
    render(tree('solemnisation'))
    await tick()
    const wall = screen.getByRole('main')
    expect(wall).not.toHaveClass('live-wall--idle')
    await tick(3_000)
    expect(wall).toHaveClass('live-wall--idle')
    fireEvent.pointerMove(window)
    expect(wall).not.toHaveClass('live-wall--idle')
    expect(screen.getByRole('button', { name: 'Pause slideshow' })).toBeInTheDocument()
  })

  it('shows a single approved photo without advancing during polling', async () => {
    api.getGallery.mockResolvedValue({ items: [first], nextCursor: null })
    render(tree('solemnisation'))
    await tick()
    await tick(60_000)
    expect(document.querySelectorAll('.live-media img')).toHaveLength(1)
    expect(mainPhoto()).toBe(first.displayUrl)
    expect(document.querySelectorAll('.live-pile-print')).toHaveLength(0)
  })

  it('clears media immediately on day-policy changes and when visibility becomes unavailable', async () => {
    api.getGallery.mockResolvedValue({ items: [first, receptionFirst], nextCursor: null })
    const view = render(tree('both'))
    await tick()
    expect(mainPhoto()).toBe(first.displayUrl)
    view.rerender(tree('reception'))
    expect(document.querySelector('.live-media')).not.toBeInTheDocument()
    await tick()
    expect(mainPhoto()).toBe(receptionFirst.displayUrl)
    view.rerender(tree(null))
    expect(document.querySelector('.live-media')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The gallery is temporarily unavailable')
  })

  it('ignores a late response from the previous source after a switch', async () => {
    api.getGallery.mockResolvedValue({ items: [first, second, receptionFirst], nextCursor: null })
    render(tree('both'))
    await tick()
    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }))
    let resolveOldPage!: (page: GalleryPage) => void
    api.getGallery.mockReturnValueOnce(new Promise<GalleryPage>(resolve => { resolveOldPage = resolve }))
    await tick(20_000)
    fireEvent.click(screen.getByRole('button', { name: '22 August' }))
    expect(document.querySelector('.live-media')).not.toBeInTheDocument()
    await tick()
    expect(mainPhoto()).toBe(receptionFirst.displayUrl)
    await act(async () => resolveOldPage({ items: [first, second, third], nextCursor: null }))
    expect(mainPhoto()).toBe(receptionFirst.displayUrl)
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

describe('live photo sizing', () => {
  beforeEach(() => {
    api.getGallery.mockReset().mockResolvedValue({ items: [mockGallery[0]], nextCursor: null })
    api.getLiveConfig.mockReset().mockResolvedValue({ source: 'all' })
  })

  it('sizes the mount from metadata first, then from the decoded photograph', async () => {
    render(tree('solemnisation'))
    const photo = await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    const ratio = () => Number.parseFloat(photo.style.getPropertyValue('--ar'))
    expect(ratio()).toBeCloseTo(mockGallery[0].width! / mockGallery[0].height!)
    Object.defineProperties(photo, { naturalWidth: { configurable: true, value: 1800 }, naturalHeight: { configurable: true, value: 900 } })
    fireEvent.load(photo)
    expect(ratio()).toBeCloseTo(2)
  })

  it('falls back to a 4:3 mount when metadata is missing', async () => {
    api.getGallery.mockResolvedValue({ items: [{ ...mockGallery[0], width: null, height: null }], nextCursor: null })
    render(tree('solemnisation'))
    const photo = await screen.findByRole('img', { name: mockGallery[0].guestMessage! })
    expect(Number.parseFloat(photo.style.getPropertyValue('--ar'))).toBeCloseTo(4 / 3)
  })
})
