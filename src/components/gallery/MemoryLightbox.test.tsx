import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GalleryMedia } from '../../../shared/contracts'
import { LocaleProvider } from '../../context/LocaleContext'
import { MemoryLightbox } from './MemoryLightbox'

const api = vi.hoisted(() => {
  class GalleryApiError extends Error {
    code: string
    retryable: boolean

    constructor(message: string, code: string, retryable = false) {
      super(message)
      this.name = 'GalleryApiError'
      this.code = code
      this.retryable = retryable
    }
  }
  return { GalleryApiError, getMediaDownload: vi.fn() }
})
vi.mock('../../services/api', () => api)

const memory: GalleryMedia = {
  id: '00000000-0000-4000-8000-000000000001',
  event: { id: 'event-solemnisation', slug: 'solemnisation', name: 'solemnisation', eventDate: '2027-08-21', displayName: 'Solemnisation', uploadEnabled: true },
  mediaType: 'photo',
  mimeType: 'image/jpeg',
  thumbnailUrl: 'https://media.test/thumb',
  displayUrl: 'https://media.test/display',
  width: 1200,
  height: 900,
  durationSeconds: null,
  guestName: 'A guest',
  guestMessage: 'A lovely memory',
  createdAt: '2027-08-21T00:00:00.000Z',
}

const videoMemory: GalleryMedia = {
  ...memory,
  id: '00000000-0000-4000-8000-000000000002',
  mediaType: 'video',
  mimeType: 'video/mp4',
  displayUrl: 'https://media.test/video',
  guestName: 'Another guest',
  durationSeconds: 12,
}

type LightboxProps = ComponentProps<typeof MemoryLightbox>

function renderLightbox(overrides: Partial<LightboxProps> = {}) {
  const props: LightboxProps = {
    items: [memory],
    index: 0,
    downloadsAvailable: true,
    onClose: vi.fn(),
    onDownloadsLocked: vi.fn(),
    onIndexChange: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  return { ...render(<LocaleProvider><MemoryLightbox {...props} /></LocaleProvider>), props }
}

describe('MemoryLightbox', () => {
  beforeEach(() => { api.getMediaDownload.mockReset() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('hides original downloads until the server reports they are available', () => {
    renderLightbox({ downloadsAvailable: false })

    expect(screen.queryByRole('button', { name: 'Download original' })).not.toBeInTheDocument()
  })

  it('requests the original and announces when the browser download starts', async () => {
    api.getMediaDownload.mockResolvedValue({ url: 'https://downloads.test/original.jpg?signature=test', expiresInSeconds: 300 })
    let clickedUrl = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { clickedUrl = this.href })
    renderLightbox()

    fireEvent.click(screen.getByRole('button', { name: 'Download original' }))

    await waitFor(() => expect(api.getMediaDownload).toHaveBeenCalledWith(memory.id))
    await waitFor(() => expect(clickedUrl).toBe('https://downloads.test/original.jpg?signature=test'))
    expect(await screen.findByText('Your original download is starting.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Download original' })).not.toBeDisabled()
  })

  it('does not start a late download after the lightbox was removed by a policy change', async () => {
    let resolve!: (result: { url: string; expiresInSeconds: number }) => void
    api.getMediaDownload.mockReturnValue(new Promise(done => { resolve = done }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const view = renderLightbox()
    fireEvent.click(screen.getByRole('button', { name: 'Download original' }))
    view.unmount()
    await act(async () => resolve({ url: 'https://downloads.test/hidden.jpg', expiresInSeconds: 30 }))
    expect(click).not.toHaveBeenCalled()
  })

  it('immediately hides downloads when the server says the release is locked', async () => {
    let rejectDownload: (reason: unknown) => void = () => undefined
    api.getMediaDownload.mockImplementation(() => new Promise((_, reject) => { rejectDownload = reject }))
    const onDownloadsLocked = vi.fn()
    const LockedHarness = () => {
      const [downloadsAvailable, setDownloadsAvailable] = useState(true)
      return (
        <LocaleProvider>
          <MemoryLightbox
            items={[memory]}
            index={0}
            downloadsAvailable={downloadsAvailable}
            onClose={vi.fn()}
            onDownloadsLocked={() => { setDownloadsAvailable(false); onDownloadsLocked() }}
            onIndexChange={vi.fn()}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
          />
        </LocaleProvider>
      )
    }
    render(<LockedHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'Download original' }))
    await waitFor(() => expect(api.getMediaDownload).toHaveBeenCalledOnce())
    rejectDownload(new api.GalleryApiError('Not yet', 'DOWNLOADS_NOT_YET_AVAILABLE'))

    await waitFor(() => expect(onDownloadsLocked).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Download original' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Original downloads are not open yet.')
  })

  it('keeps the memory open and uses the unified toast for download failures', async () => {
    let rejectDownload: (reason: unknown) => void = () => undefined
    api.getMediaDownload.mockImplementation(() => new Promise((_, reject) => { rejectDownload = reject }))
    renderLightbox()

    fireEvent.click(screen.getByRole('button', { name: 'Download original' }))
    await waitFor(() => expect(api.getMediaDownload).toHaveBeenCalledOnce())
    rejectDownload(new Error('downloads blocked'))

    expect(await screen.findByRole('alert')).toHaveTextContent('The original could not be prepared for download.')
    expect(screen.getByRole('dialog', { name: /Memory viewer/ })).toBeInTheDocument()
  })

  it('hides one-item navigation and includes the localized position in the dialog label', () => {
    renderLightbox()

    expect(screen.queryByRole('button', { name: 'Previous memory' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next memory' })).not.toBeInTheDocument()
    expect(screen.getByText('Memory 1 of 1')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /photo from A guest\. Memory 1 of 1/ })).toBeInTheDocument()
  })

  it('does not intercept arrow keys from native video controls', () => {
    const onIndexChange = vi.fn()
    renderLightbox({ items: [memory, videoMemory], index: 1, onIndexChange })
    const video = screen.getByLabelText('Video memory from Another guest')

    fireEvent.keyDown(video, { key: 'ArrowRight' })
    expect(onIndexChange).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onIndexChange).toHaveBeenCalledWith(0)
  })

  it('makes metadata-preloaded video interactive as soon as its metadata is ready', () => {
    renderLightbox({ items: [videoMemory] })
    const video = screen.getByLabelText('Video memory from Another guest')

    expect(screen.getByText('Preparing this memory…')).toBeInTheDocument()
    fireEvent.loadedMetadata(video)

    expect(screen.queryByText('Preparing this memory…')).not.toBeInTheDocument()
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('tabindex', '0')
  })

  it('shows media progress and offers a retry when refreshing a failed URL does not replace it', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderLightbox({ onRefresh })
    const image = screen.getByRole('img', { name: 'A lovely memory' })

    expect(screen.getByText('Preparing this memory…')).toBeInTheDocument()
    fireEvent.error(image)

    const retry = await screen.findByRole('button', { name: 'Try loading again' })
    expect(onRefresh).toHaveBeenCalledWith(memory.id)
    fireEvent.click(retry)
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2))

    const reloaded = screen.getByRole('img', { name: 'A lovely memory' })
    expect(reloaded).not.toBe(image)
    expect(reloaded).toHaveAttribute('src', memory.displayUrl)
    fireEvent.load(reloaded)
    expect(screen.queryByText('Preparing this memory…')).not.toBeInTheDocument()
  })

  it('keeps a late refresh from replacing the ready state of the next photograph', async () => {
    let finish!: () => void
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const second = { ...memory, id: videoMemory.id, displayUrl: 'https://media.test/second', guestMessage: 'Another moment' }
    const view = renderLightbox({ items: [memory, second], onRefresh })
    fireEvent.error(screen.getByRole('img', { name: 'A lovely memory' }))
    expect(onRefresh).toHaveBeenCalledOnce()
    view.rerender(<LocaleProvider><MemoryLightbox {...view.props} index={1} /></LocaleProvider>)
    fireEvent.load(screen.getByRole('img', { name: 'Another moment' }))
    await act(async () => finish())
    expect(screen.queryByText('Preparing this memory…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try loading again' })).not.toBeInTheDocument()
  })

  it('keeps caption gestures separate from photo swipes while the body supports keyboard navigation', () => {
    const onIndexChange = vi.fn()
    const onClose = vi.fn()
    const view = renderLightbox({ items: [memory, videoMemory], onIndexChange, onClose })
    const notes = view.container.querySelector('figcaption')!
    fireEvent.touchStart(notes, { touches: [{ clientX: 200, clientY: 100 }] })
    fireEvent.touchEnd(notes, { changedTouches: [{ clientX: 30, clientY: 105 }] })
    expect(onIndexChange).not.toHaveBeenCalled()
    const image = screen.getByRole('img', { name: 'A lovely memory' })
    fireEvent.touchStart(image, { touches: [{ clientX: 200, clientY: 100 }] })
    fireEvent.touchEnd(image, { changedTouches: [{ clientX: 130, clientY: 250 }] })
    expect(onIndexChange).not.toHaveBeenCalled()
    fireEvent.touchStart(image, { touches: [{ clientX: 200, clientY: 100 }] })
    fireEvent.touchEnd(image, { changedTouches: [{ clientX: 30, clientY: 110 }] })
    expect(onIndexChange).toHaveBeenCalledWith(1)
    onIndexChange.mockClear()
    fireEvent.keyDown(screen.getByRole('figure'), { key: 'ArrowRight' })
    expect(onIndexChange).toHaveBeenCalledWith(1)
    fireEvent.keyDown(notes, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('focuses close, traps keyboard focus and restores the opener', async () => {
    const opener = render(<button type="button">Open photograph</button>)
    const trigger = screen.getByRole('button', { name: 'Open photograph' })
    trigger.focus()
    const view = renderLightbox({ items: [memory, videoMemory] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close memory' })).toHaveFocus())
    const first = screen.getByRole('button', { name: 'Download original' })
    const last = screen.getByRole('button', { name: 'Next memory' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    expect(screen.getByRole('figure')).toHaveAttribute('tabindex', '0')
    expect(view.container.querySelector('figcaption')).not.toHaveAttribute('tabindex')
    view.unmount()
    expect(trigger).toHaveFocus()
    opener.unmount()
  })

  it('shares the existing deep link and announces clipboard failures', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share: undefined, clipboard: { writeText } })
    renderLightbox()
    fireEvent.click(screen.getByRole('button', { name: 'Share memory' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}?memory=${memory.id}`))
    expect(await screen.findByText('Link copied')).toBeVisible()
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Share memory' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The link could not be copied.')
  })

  it('shows only a localized event date for a memory without a guest message or name', () => {
    window.localStorage.setItem('an-gallery-locale', 'ms')
    const view = renderLightbox({ items: [{ ...memory, guestName: null, guestMessage: null, createdAt: '2027-09-10T12:00:00Z' }] })
    expect(screen.getByText('Jurnal perkahwinan')).toBeVisible()
    const notes = view.container.querySelector('figcaption')!
    expect(notes).toHaveTextContent(/^21 OGOS 2027$/)
    expect(notes.querySelector('time')).toHaveAttribute('datetime', '2027-08-21')
    expect(notes.querySelector('blockquote')).toBeNull()
    expect(notes.querySelector('h2')).toBeNull()
    expect(notes).not.toHaveAttribute('tabindex')
    expect(notes).not.toHaveAttribute('aria-label')
  })

  it('preserves a long wish and attribution, then returns the whole body to its photograph on navigation', () => {
    const message = 'May your days be filled with love, laughter and wonderful memories together. '.repeat(3)
    const first = { ...memory, guestMessage: message }
    const view = renderLightbox({ items: [first, videoMemory] })
    const notes = view.container.querySelector('figcaption')!
    expect(notes.querySelector('blockquote')).toHaveTextContent(message.trim())
    expect(notes).toHaveTextContent('Shared by A guest')
    expect(notes.querySelector('time')).toHaveTextContent('21 AUG 2027')
    expect(notes.querySelector('h2,svg')).toBeNull()
    const body = screen.getByRole('figure')
    body.scrollTop = 240
    view.rerender(<LocaleProvider><MemoryLightbox {...view.props} index={1} /></LocaleProvider>)
    expect(body.scrollTop).toBe(0)
    expect(screen.getByRole('button', { name: 'Next memory' })).toBeEnabled()
  })
})
