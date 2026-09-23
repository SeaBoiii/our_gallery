import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GalleryMedia, GalleryPage } from '../../../shared/contracts'
import { LocaleProvider } from '../../context/LocaleContext'
import { mockGallery } from '../../data/mock'
import { GalleryGrid } from './GalleryGrid'

const api = vi.hoisted(() => ({ getGallery: vi.fn(), getGalleryMedia: vi.fn() }))
vi.mock('../../services/api', () => api)
vi.mock('../../hooks/useDownloadAvailability', () => ({
  useDownloadAvailability: () => ({
    downloadsAvailable: false,
    availableAt: '2027-08-23T00:00:00+08:00',
    markDownloadsLocked: vi.fn(),
  }),
}))
vi.mock('./MemoryLightbox', () => ({
  MemoryLightbox: ({ items, index, onClose }: { items: GalleryMedia[]; index: number; onClose: () => void }) => (
    <div role="dialog" aria-label="Test memory viewer">
      <span>{items[index].guestName}</span>
      <button type="button" onClick={onClose}>Close test viewer</button>
    </div>
  ),
}))

function renderGallery(onAddMemory = vi.fn()) {
  return render(<LocaleProvider><GalleryGrid onAddMemory={onAddMemory} /></LocaleProvider>)
}

describe('gallery experience', () => {
  beforeEach(() => {
    api.getGallery.mockReset()
    api.getGalleryMedia.mockReset()
    window.localStorage.removeItem('an-gallery-locale')
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens cached media immediately while refreshing it in the background and preserves the URL', async () => {
    let resolveRefresh: ((memory: GalleryMedia) => void) | undefined
    const pendingRefresh = new Promise<GalleryMedia>((resolve) => { resolveRefresh = resolve })
    api.getGallery.mockResolvedValue({ items: [mockGallery[0]], nextCursor: null } satisfies GalleryPage)
    api.getGalleryMedia.mockReturnValue(pendingRefresh)
    window.history.replaceState({}, '', '/?invitation=family#gallery')
    renderGallery()

    const card = await screen.findByRole('button', { name: /open photo/i })
    fireEvent.click(card)

    expect(screen.getByRole('dialog', { name: 'Test memory viewer' })).toBeInTheDocument()
    expect(api.getGalleryMedia).toHaveBeenCalledWith(mockGallery[0].id)
    expect(window.location.search).toContain('invitation=family')
    expect(window.location.search).toContain(`memory=${mockGallery[0].id}`)
    expect(window.location.hash).toBe('#gallery')

    act(() => {
      window.history.replaceState({}, '', '/?invitation=family#gallery')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.queryByRole('dialog', { name: 'Test memory viewer' })).not.toBeInTheDocument()
    expect(window.location.search).toBe('?invitation=family')
    expect(window.location.hash).toBe('#gallery')
    await act(async () => resolveRefresh?.(mockGallery[0]))
  })

  it('shows the quiet download release note in Bahasa Melayu while downloads are locked', async () => {
    window.localStorage.setItem('an-gallery-locale', 'ms')
    api.getGallery.mockResolvedValue({ items: [mockGallery[0]], nextCursor: null } satisfies GalleryPage)
    api.getGalleryMedia.mockResolvedValue(mockGallery[0])

    renderGallery()

    expect(await screen.findByText('Muat turun fail asal dibuka pada 23 Ogos 2027.')).toBeInTheDocument()
  })

  it('replaces stale results with skeletons while applying filters, then offers a reset for no matches', async () => {
    let resolveFiltered: ((page: GalleryPage) => void) | undefined
    api.getGallery
      .mockResolvedValueOnce({ items: [mockGallery[0]], nextCursor: null } satisfies GalleryPage)
      .mockReturnValueOnce(new Promise<GalleryPage>((resolve) => { resolveFiltered = resolve }))
    renderGallery()

    expect(await screen.findByRole('button', { name: /open photo/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Videos' }))
    expect(screen.queryByRole('button', { name: /open photo/i })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.memory-skeleton')).toHaveLength(8)

    await act(async () => resolveFiltered?.({ items: [], nextCursor: null }))
    expect(await screen.findByRole('heading', { name: /no memories match/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('uses browser history to close a gallery-opened viewer', async () => {
    api.getGallery.mockResolvedValue({ items: [mockGallery[0]], nextCursor: null } satisfies GalleryPage)
    api.getGalleryMedia.mockResolvedValue(mockGallery[0])
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    renderGallery()

    fireEvent.click(await screen.findByRole('button', { name: /open photo/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Close test viewer' }))
    await waitFor(() => expect(back).toHaveBeenCalledOnce())
  })

  it('does not prepend a stale detail response after the active filters change', async () => {
    let resolveRefresh: ((memory: GalleryMedia) => void) | undefined
    api.getGallery
      .mockResolvedValueOnce({ items: [mockGallery[0]], nextCursor: null } satisfies GalleryPage)
      .mockResolvedValueOnce({ items: [], nextCursor: null } satisfies GalleryPage)
    api.getGalleryMedia.mockReturnValue(new Promise<GalleryMedia>((resolve) => { resolveRefresh = resolve }))
    renderGallery()

    fireEvent.click(await screen.findByRole('button', { name: /open photo/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Videos' }))
    await act(async () => resolveRefresh?.(mockGallery[0]))

    expect(await screen.findByRole('heading', { name: /no memories match/i })).toBeInTheDocument()
    expect(document.querySelectorAll('.memory-card')).toHaveLength(0)
  })

  it('offers Add Memory when the approved gallery is truly empty', async () => {
    const onAddMemory = vi.fn()
    api.getGallery.mockResolvedValue({ items: [], nextCursor: null } satisfies GalleryPage)
    renderGallery(onAddMemory)

    const heading = await screen.findByRole('heading', { name: 'Every story starts with a moment.' })
    expect(heading.closest('.gallery-state')).toHaveAttribute('role', 'status')
    fireEvent.click(screen.getByRole('button', { name: 'Add a memory' }))
    expect(onAddMemory).toHaveBeenCalledOnce()
  })

  it('keeps loaded cards and retries the failed pagination cursor', async () => {
    let triggerIntersection: (() => void) | null = null
    vi.stubGlobal('IntersectionObserver', class {
      private readonly callback: IntersectionObserverCallback
      constructor(callback: IntersectionObserverCallback) { this.callback = callback }
      observe = () => {
        triggerIntersection = () => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      disconnect = vi.fn()
      unobserve = vi.fn()
      takeRecords = () => []
      root = null
      rootMargin = ''
      thresholds = []
    })
    api.getGallery
      .mockResolvedValueOnce({ items: [mockGallery[0]], nextCursor: 'page-two' } satisfies GalleryPage)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [mockGallery[1]], nextCursor: null } satisfies GalleryPage)
    api.getGalleryMedia.mockResolvedValue(mockGallery[0])
    renderGallery()

    expect(await screen.findByRole('button', { name: /open photo/i })).toBeInTheDocument()
    await waitFor(() => expect(triggerIntersection).not.toBeNull())
    act(() => triggerIntersection?.())
    expect(await screen.findByText('More memories could not be loaded.')).toBeInTheDocument()
    expect(document.querySelectorAll('.memory-card')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(document.querySelectorAll('.memory-card')).toHaveLength(2))
    expect(api.getGallery).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'page-two' }))
  })

  it('switches between journal and grid without reloading or reordering memories', async () => {
    api.getGallery.mockResolvedValue({ items: mockGallery.slice(0, 3), nextCursor: null } satisfies GalleryPage)
    api.getGalleryMedia.mockResolvedValue(mockGallery[1])
    renderGallery()
    await screen.findAllByRole('button', { name: /open photo/i })
    const labels = () => screen.getAllByRole('button', { name: /open photo/i }).map((button) => button.getAttribute('aria-label'))
    const initialOrder = labels()
    expect(screen.getByRole('button', { name: 'Journal view' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }))
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
    expect(labels()).toEqual(initialOrder)
    expect(api.getGallery).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getAllByRole('button', { name: /open photo/i })[1])
    expect(screen.getByRole('dialog', { name: 'Test memory viewer' })).toHaveTextContent(mockGallery[1].guestName!)
    expect(window.location.search).toContain(`memory=${mockGallery[1].id}`)
  })
})
