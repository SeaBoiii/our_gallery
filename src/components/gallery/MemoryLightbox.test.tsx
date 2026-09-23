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
  afterEach(() => { vi.restoreAllMocks() })

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

    fireEvent.load(image)
    expect(screen.queryByText('Preparing this memory…')).not.toBeInTheDocument()
  })
})
