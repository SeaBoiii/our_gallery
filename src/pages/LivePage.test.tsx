import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GalleryPage } from '../../shared/contracts'
import { LocaleProvider } from '../context/LocaleContext'
import { mockGallery } from '../data/mock'
import { publicConfig, TestVisibilityProvider } from '../test/visibility'
import LivePage from './LivePage'

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
