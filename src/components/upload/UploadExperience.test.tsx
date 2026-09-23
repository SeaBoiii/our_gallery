import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompleteUploadResponse, EventSlug, GalleryEvent, PrepareUploadRequest, PrepareUploadResponse, PublicGalleryConfig } from '../../../shared/contracts'
import { LocaleProvider } from '../../context/LocaleContext'
import { copy } from '../../i18n/copy'
import { GalleryApiError, prepareUploads } from '../../services/api'
import { createImageDerivatives } from '../../utils/files'
import { UploadTransferError, uploadQueueItem } from '../../services/upload'
import { UploadExperience } from './UploadExperience'

const visibility = vi.hoisted(() => ({ config: null as PublicGalleryConfig | null, status: 'ready' as 'ready' | 'loading' | 'error', refresh: vi.fn<() => Promise<PublicGalleryConfig>>() }))
vi.mock('../../context/useGalleryVisibility', () => ({ useGalleryVisibility: () => visibility }))

vi.mock('../../config', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../config')>(),
  USE_MOCK_DATA: false,
  TURNSTILE_SITE_KEY: 'test-site-key',
}))

vi.mock('../../services/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/api')>(),
  prepareUploads: vi.fn(),
}))

vi.mock('../../services/upload', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/upload')>(),
  uploadQueueItem: vi.fn(),
}))

vi.mock('../../utils/files', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../utils/files')>(),
  createImageDerivatives: vi.fn().mockResolvedValue([]),
  fingerprintFile: vi.fn().mockResolvedValue('a'.repeat(64)),
}))

const t = copy.en.upload
const events: GalleryEvent[] = [
  { id: 'day-one', slug: 'solemnisation', name: 'solemnisation', eventDate: '2027-08-21', displayName: "Nikah & Bride's Reception", uploadEnabled: true },
  { id: 'day-two', slug: 'reception', name: 'reception', eventDate: '2027-08-22', displayName: "Groom's Reception", uploadEnabled: true },
]

function configuration(mode: 'both' | EventSlug = 'both'): PublicGalleryConfig {
  return { mode, events: events.filter(event => mode === 'both' || event.slug === mode), uploadsEnabled: true, serverTime: new Date().toISOString(), nextTransitionAt: null, revision: mode, validUntil: new Date(Date.now() + 30_000).toISOString() }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function prepared(payload: PrepareUploadRequest): PrepareUploadResponse {
  return { uploads: payload.files.map((file) => ({
    clientId: file.clientId,
    mediaId: crypto.randomUUID(),
    original: { url: 'https://upload.test/original', requiredHeaders: {}, expiresAt: new Date(Date.now() + 600_000).toISOString() },
  })) }
}

const photo = (name = 'memory.jpg') => new File(['a photograph'], name, { type: 'image/jpeg', lastModified: 1 })
const video = (name = 'memory.mp4') => new File(['a video'], name, { type: 'video/mp4', lastModified: 1 })
const received = (id = 'uploaded'): CompleteUploadResponse => ({ mediaId: id, status: 'pending' })
let widgets: Record<string, unknown>[] = []

function verify(token = 'verified-token') {
  const options = widgets.at(-1)
  if (!options) throw new Error('Verification widget has not mounted')
  act(() => { (options.callback as (token: string) => void)(token) })
}

function mount(files: File[] = [], lockedEventSlug?: EventSlug) {
  const props = { open: true, initialFiles: files, onClose: vi.fn(), onViewGallery: vi.fn(), lockedEventSlug }
  const tree = (open = true) => <LocaleProvider><UploadExperience {...props} open={open} /></LocaleProvider>
  const result = render(tree())
  return { ...result, ...props, reopen: (nextFiles?: File[]) => { if (nextFiles) props.initialFiles = nextFiles; result.rerender(tree()) }, hide: () => result.rerender(tree(false)) }
}

async function details() {
  await waitFor(() => expect(screen.getByRole('button', { name: t.continue })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: t.continue }))
  expect(await screen.findByRole('heading', { name: t.sharing })).toBeInTheDocument()
  await waitFor(() => expect(widgets.length).toBeGreaterThan(0))
}

async function send() {
  verify()
  const button = screen.getByRole('button', { name: t.startUpload })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

beforeEach(() => {
  vi.clearAllMocks()
  visibility.config = configuration()
  visibility.status = 'ready'
  visibility.refresh.mockResolvedValue(visibility.config)
  vi.mocked(createImageDerivatives).mockResolvedValue([])
  vi.mocked(prepareUploads).mockImplementation(async (payload) => prepared(payload))
  vi.mocked(uploadQueueItem).mockImplementation(async (item, onProgress) => { onProgress(100); return received(item.prepared?.mediaId) })
  widgets = []
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:guest-memory')
    static revokeObjectURL = vi.fn()
  })
  window.turnstile = {
    render: vi.fn((_element, options) => { widgets.push(options); return `widget-${widgets.length}` }),
    remove: vi.fn(),
    reset: vi.fn(),
  }
  const script = document.createElement('script')
  script.id = 'turnstile-script'
  document.head.append(script)
})

afterEach(() => {
  document.getElementById('turnstile-script')?.remove()
  delete window.turnstile
  vi.unstubAllGlobals()
})

describe('two-stage memory submission', () => {
  it('selects media first, collects details second, and confirms receipt pending review', async () => {
    mount()
    expect(screen.getByRole('heading', { name: t.addMemories })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.continue })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(t.selectMultiple), { target: { files: [photo(), video()] } })
    expect(screen.getByText('memory.jpg')).toBeInTheDocument()
    expect(screen.getByText('memory.mp4')).toBeInTheDocument()
    await details()
    expect(screen.getByRole('button', { name: t.startUpload })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(t.namePlaceholder), { target: { value: '  Mariam  ' } })
    fireEvent.change(screen.getByPlaceholderText(t.messagePlaceholder), { target: { value: '  A wonderful day.  ' } })
    fireEvent.click(screen.getAllByRole('radio')[1])
    await send()
    expect(await screen.findByRole('heading', { name: t.success })).toBeInTheDocument()
    expect(screen.getByText(t.successBody)).toBeInTheDocument()
    expect(screen.getByText(t.safe)).toBeInTheDocument()
    expect(`${t.successBody} ${t.safe}`).toMatch(/review|approv/i)
    expect(prepareUploads).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prepareUploads).mock.calls[0][0]).toMatchObject({ eventSlug: 'reception', guestName: 'Mariam', guestMessage: 'A wonderful day.', turnstileToken: 'verified-token' })
    expect(vi.mocked(prepareUploads).mock.calls[0][0].files.map((file) => file.filename)).toEqual(['memory.jpg', 'memory.mp4'])
    expect(uploadQueueItem).toHaveBeenCalledTimes(2)
    expect(widgets[0].action).toBe('upload_prepare')
  })

  it('retries an individual failed file without preparing again or resending completed files', async () => {
    vi.mocked(uploadQueueItem).mockImplementation(async (item, onProgress, options) => {
      if (item.file.name === 'retry.jpg' && !options?.refreshBeforeUpload) throw new UploadTransferError('NETWORK_INTERRUPTED', 'Connection dropped')
      onProgress(100)
      return received()
    })
    mount([photo('complete.jpg'), photo('retry.jpg')])
    await details()
    await send()
    const retry = await screen.findByRole('button', { name: `${t.retryFile} retry.jpg` })
    expect(screen.queryByRole('heading', { name: t.success })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(t.networkInterrupted)
    fireEvent.click(retry)
    expect(await screen.findByRole('heading', { name: t.success })).toBeInTheDocument()
    expect(prepareUploads).toHaveBeenCalledTimes(1)
    expect(vi.mocked(uploadQueueItem).mock.calls.map(([item]) => item.file.name)).toEqual(['complete.jpg', 'retry.jpg', 'retry.jpg'])
    expect(vi.mocked(uploadQueueItem).mock.calls[2][2]).toEqual({ refreshBeforeUpload: true })
  })

  it('waits for the whole batch before exposing retry, and blocks closing during outstanding work', async () => {
    const transfer = deferred<CompleteUploadResponse>()
    vi.mocked(uploadQueueItem).mockImplementation(async (item, onProgress, options) => {
      if (item.file.name === 'long-video.mp4') return transfer.promise
      if (!options?.refreshBeforeUpload) throw new UploadTransferError('NETWORK_INTERRUPTED', 'Connection dropped')
      onProgress(100)
      return received()
    })
    const view = mount([photo('retry.jpg'), video('long-video.mp4')])
    await details()
    await send()
    await waitFor(() => expect(uploadQueueItem).toHaveBeenCalledTimes(2))
    await screen.findByText(t.networkInterrupted)
    expect(screen.queryByRole('button', { name: `${t.retryFile} retry.jpg` })).not.toBeInTheDocument()
    const retryAll = screen.queryByRole('button', { name: t.retry })
    if (retryAll) expect(retryAll).toBeDisabled()
    expect(screen.getByRole('button', { name: t.close })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(view.onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: t.success })).not.toBeInTheDocument()
    await act(async () => { transfer.resolve(received()); await transfer.promise })
    fireEvent.click(await screen.findByRole('button', { name: t.retry }))
    expect(await screen.findByRole('heading', { name: t.success })).toBeInTheDocument()
    expect(vi.mocked(uploadQueueItem).mock.calls.filter(([item]) => item.file.name === 'long-video.mp4')).toHaveLength(1)
  })

  it.each(['one', 'all'] as const)('prepares new selections after retrying %s from a reopened partial batch across a date change', async (retryMode) => {
    vi.mocked(uploadQueueItem).mockImplementation(async (item, onProgress, options) => {
      if (item.file.name === 'retry.jpg' && !options?.refreshBeforeUpload) throw new UploadTransferError('NETWORK_INTERRUPTED', 'Connection dropped')
      onProgress(100)
      return received(item.prepared?.mediaId)
    })
    visibility.config = configuration('solemnisation')
    visibility.refresh.mockResolvedValue(visibility.config)
    const view = mount([photo('complete.jpg'), photo('retry.jpg')])
    await details()
    fireEvent.change(screen.getByPlaceholderText(t.namePlaceholder), { target: { value: 'Mariam' } })
    await send()
    await screen.findByRole('button', { name: t.retry })
    fireEvent.click(screen.getByRole('button', { name: t.close }))
    view.hide()
    visibility.config = configuration('reception')
    visibility.refresh.mockResolvedValue(visibility.config)
    view.reopen([photo('new-selection.jpg')])
    await screen.findByText('new-selection.jpg')
    expect(screen.getByRole('heading', { name: t.checkingIn })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.success })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: retryMode === 'one' ? `${t.retryFile} retry.jpg` : t.retry }))
    await screen.findByRole('heading', { name: t.sharing })
    expect(screen.queryByRole('heading', { name: t.success })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(t.namePlaceholder)).toHaveValue('Mariam')
    expect(screen.getByRole('button', { name: t.startUpload })).toBeDisabled()
    expect(prepareUploads).toHaveBeenCalledOnce()
    expect(vi.mocked(uploadQueueItem).mock.calls[2][0].prepared).toEqual(vi.mocked(uploadQueueItem).mock.calls[1][0].prepared)
    await waitFor(() => expect(widgets).toHaveLength(2))
    verify('new-batch-token')
    fireEvent.click(screen.getByRole('button', { name: t.startUpload }))
    await screen.findByRole('heading', { name: t.success })
    const [first, second] = vi.mocked(prepareUploads).mock.calls.map(([payload]) => payload)
    expect(first.eventSlug).toBe('solemnisation')
    expect(second.eventSlug).toBe('reception')
    expect(second.requestId).not.toBe(first.requestId)
    expect(second.turnstileToken).toBe('new-batch-token')
    expect(second.files.map(file => file.filename)).toEqual(['new-selection.jpg'])
    expect(vi.mocked(uploadQueueItem).mock.calls.map(([item]) => item.file.name)).toEqual(['complete.jpg', 'retry.jpg', 'retry.jpg', 'new-selection.jpg'])
    expect(document.querySelector('.success-ticket')).toHaveTextContent('3')
  })

  it('retains selections arriving while preparation is pending and prepares them separately', async () => {
    const preparation = deferred<PrepareUploadResponse>()
    vi.mocked(prepareUploads).mockReturnValueOnce(preparation.promise)
    const view = mount([photo('first.jpg')])
    await details()
    await send()
    await waitFor(() => expect(prepareUploads).toHaveBeenCalledOnce())
    const first = vi.mocked(prepareUploads).mock.calls[0][0]
    view.reopen([photo('later.jpg')])
    await screen.findByText('later.jpg')
    await act(async () => { preparation.resolve(prepared(first)); await preparation.promise })
    await screen.findByRole('heading', { name: t.sharing })
    expect(screen.queryByRole('heading', { name: t.success })).not.toBeInTheDocument()
    expect(uploadQueueItem).toHaveBeenCalledOnce()
    await waitFor(() => expect(widgets).toHaveLength(2))
    await send()
    await screen.findByRole('heading', { name: t.success })
    expect(vi.mocked(prepareUploads).mock.calls[1][0].files.map(file => file.filename)).toEqual(['later.jpg'])
    expect(vi.mocked(uploadQueueItem).mock.calls.map(([item]) => item.file.name)).toEqual(['first.jpg', 'later.jpg'])
    expect(document.querySelector('.success-ticket')).toHaveTextContent('2')
  })

  it('preserves files after a failed preparation and uses a fresh request ID when details change', async () => {
    vi.mocked(prepareUploads).mockRejectedValueOnce(new GalleryApiError('Could not connect', 'NETWORK_ERROR', true))
    mount([photo('kept.jpg')])
    await details()
    fireEvent.change(screen.getByPlaceholderText(t.namePlaceholder), { target: { value: 'Mariam' } })
    await send()
    expect(await screen.findByRole('alert')).toHaveTextContent(t.connectionLost)
    expect(screen.getByRole('heading', { name: t.sharing })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.startUpload })).toBeDisabled()
    expect(uploadQueueItem).not.toHaveBeenCalled()
    await waitFor(() => expect(widgets).toHaveLength(2))
    const first = vi.mocked(prepareUploads).mock.calls[0][0]
    fireEvent.click(screen.getByRole('button', { name: t.back }))
    expect(screen.getByText('kept.jpg')).toBeInTheDocument()
    await details()
    fireEvent.change(screen.getByPlaceholderText(t.namePlaceholder), { target: { value: 'Mariam & family' } })
    verify('fresh-verification')
    fireEvent.click(screen.getByRole('button', { name: t.startUpload }))
    await screen.findByRole('heading', { name: t.success })
    const second = vi.mocked(prepareUploads).mock.calls[1][0]
    expect(second.requestId).not.toBe(first.requestId)
    expect(second.guestName).toBe('Mariam & family')
    expect(second.files).toEqual(first.files)
    expect(second.turnstileToken).toBe('fresh-verification')
  })

  it('preserves the same request ID on an unchanged preparation retry after token renewal', async () => {
    vi.mocked(prepareUploads).mockRejectedValueOnce(new GalleryApiError('Verification failed', 'TURNSTILE_FAILED', true))
    mount([photo()])
    await details()
    await send()
    expect(await screen.findByRole('alert')).toHaveTextContent(t.verificationFailed)
    expect(screen.getByRole('button', { name: t.startUpload })).toBeDisabled()
    const first = vi.mocked(prepareUploads).mock.calls[0][0]
    verify('renewed-token')
    fireEvent.click(screen.getByRole('button', { name: t.startUpload }))
    await screen.findByRole('heading', { name: t.success })
    const second = vi.mocked(prepareUploads).mock.calls[1][0]
    expect(second.requestId).toBe(first.requestId)
    expect(second.files).toEqual(first.files)
    expect(second.turnstileToken).toBe('renewed-token')
  })

  it('excludes completed files when authorization for another file expires', async () => {
    let expiringAttempts = 0
    vi.mocked(uploadQueueItem).mockImplementation(async (item, onProgress) => {
      if (item.file.name === 'expired.jpg' && expiringAttempts++ === 0) throw new GalleryApiError('Expired', 'UPLOAD_AUTHORIZATION_EXPIRED')
      onProgress(100)
      return received()
    })
    mount([photo('complete.jpg'), photo('expired.jpg')])
    await details()
    await send()
    expect(await screen.findByRole('alert')).toHaveTextContent(t.checkInExpired)
    expect(screen.getByRole('heading', { name: t.sharing })).toBeInTheDocument()
    await send()
    await screen.findByRole('heading', { name: t.success })
    expect(prepareUploads).toHaveBeenCalledTimes(2)
    const [first, second] = vi.mocked(prepareUploads).mock.calls.map(([payload]) => payload)
    expect(second.requestId).not.toBe(first.requestId)
    expect(second.files.map((file) => file.filename)).toEqual(['expired.jpg'])
    expect(vi.mocked(uploadQueueItem).mock.calls.filter(([item]) => item.file.name === 'complete.jpg')).toHaveLength(1)
    expect(document.querySelector('.success-ticket')).toHaveTextContent('2')
    fireEvent.click(screen.getByRole('button', { name: t.addMore }))
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('keeps pending preparation inside the dialog and preserves the selection on close/reopen after failure', async () => {
    const preparation = deferred<PrepareUploadResponse>()
    vi.mocked(prepareUploads).mockReturnValueOnce(preparation.promise)
    const view = mount([photo('remember.jpg')])
    await details()
    await send()
    await waitFor(() => expect(prepareUploads).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: t.close })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.onClose).not.toHaveBeenCalled()
    await act(async () => { preparation.reject(new GalleryApiError('Network interrupted', 'NETWORK_ERROR')); await preparation.promise.catch(() => undefined) })
    await screen.findByRole('heading', { name: t.sharing })
    fireEvent.click(screen.getByRole('button', { name: t.close }))
    expect(view.onClose).toHaveBeenCalledTimes(1)
    view.hide()
    view.reopen()
    fireEvent.click(await screen.findByRole('button', { name: t.back }))
    const queue = screen.getByRole('list', { name: t.selectedMemories })
    expect(within(queue).getAllByRole('listitem')).toHaveLength(1)
    expect(within(queue).getByText('remember.jpg')).toBeInTheDocument()
  })

  it('disables submission on token expiry or widget errors until new verification succeeds', async () => {
    mount([photo()])
    await details()
    verify()
    const button = screen.getByRole('button', { name: t.startUpload })
    expect(button).toBeEnabled()
    act(() => { (widgets.at(-1)!['expired-callback'] as () => void)() })
    expect(button).toBeDisabled()
    verify('second-token')
    expect(button).toBeEnabled()
    act(() => { (widgets.at(-1)!['error-callback'] as () => void)() })
    expect(button).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(t.verificationFailed)
    expect(prepareUploads).not.toHaveBeenCalled()
    verify('third-token')
    expect(button).toBeEnabled()
  })
})

describe('day-aware upload preparation', () => {
  it('automatically selects the sole visible date without exposing a second date or selector', async () => {
    visibility.config = configuration('solemnisation')
    visibility.refresh.mockResolvedValue(visibility.config)
    mount([photo()])
    await details()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).not.toHaveTextContent('22')
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/Nikah|Bride|Groom|Day 0/i)
    await send()
    await screen.findByRole('heading', { name: t.success })
    expect(vi.mocked(prepareUploads).mock.calls[0][0].eventSlug).toBe('solemnisation')
  })

  it('keeps a framed print locked to its printed date even when both albums are visible', async () => {
    mount([photo('print.png')], 'reception')
    await details()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    await send()
    await screen.findByRole('heading', { name: t.success })
    expect(vi.mocked(prepareUploads).mock.calls[0][0].eventSlug).toBe('reception')
  })

  it('does not relabel or submit a print whose date has become hidden', async () => {
    visibility.config = configuration('reception')
    visibility.refresh.mockResolvedValue(visibility.config)
    mount([photo('original-print.png')], 'solemnisation')
    await details()
    verify()
    expect(screen.getByRole('button', { name: t.startUpload })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Return to the photo booth')
    expect(prepareUploads).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: t.back }))
    expect(screen.getByText('original-print.png')).toBeInTheDocument()
  })

  it('rechecks the date after derivative generation and preserves files for review when it changed', async () => {
    const derivatives = deferred<Awaited<ReturnType<typeof createImageDerivatives>>>()
    vi.mocked(createImageDerivatives).mockReturnValueOnce(derivatives.promise)
    visibility.config = configuration('solemnisation')
    visibility.refresh.mockResolvedValue(visibility.config)
    mount([photo('overnight.jpg')])
    await details()
    await send()
    await waitFor(() => expect(createImageDerivatives).toHaveBeenCalledOnce())
    visibility.refresh.mockResolvedValue(configuration('reception'))
    await act(async () => derivatives.resolve([]))
    expect(await screen.findByRole('heading', { name: t.sharing })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Please review the date')
    expect(prepareUploads).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: t.back }))
    expect(screen.getByText('overnight.jpg')).toBeInTheDocument()
  })

  it('fails closed without discarding local files when visibility cannot be verified', async () => {
    visibility.config = null
    visibility.status = 'error'
    visibility.refresh.mockRejectedValue(new Error('offline'))
    mount([photo('local-only.jpg')])
    await details()
    verify()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.startUpload })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('selected files are still here')
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/21|22/)
    expect(prepareUploads).not.toHaveBeenCalled()
  })

  it.each([undefined, 'solemnisation'] as const)('allows an already authorized failed transfer with lock %s to retry after its day becomes hidden', async (lockedEventSlug) => {
    vi.mocked(uploadQueueItem).mockRejectedValueOnce(new UploadTransferError('NETWORK_INTERRUPTED', 'offline')).mockResolvedValue(received())
    visibility.config = configuration('solemnisation')
    visibility.refresh.mockResolvedValue(visibility.config)
    const view = mount([photo('authorized.jpg')], lockedEventSlug)
    await details()
    await send()
    const retry = await screen.findByRole('button', { name: `${t.retryFile} authorized.jpg` })
    visibility.config = configuration('reception')
    visibility.refresh.mockResolvedValue(visibility.config)
    view.reopen()
    expect(screen.queryByText(/Return to the photo booth/)).not.toBeInTheDocument()
    if (lockedEventSlug) expect(screen.getByRole('status')).toHaveTextContent('This print is already checked in')
    fireEvent.click(retry)
    await screen.findByRole('heading', { name: t.success })
    expect(screen.queryByText(/This print is already checked in/)).not.toBeInTheDocument()
    expect(prepareUploads).toHaveBeenCalledOnce()
    expect(vi.mocked(prepareUploads).mock.calls[0][0].eventSlug).toBe('solemnisation')
    expect(vi.mocked(uploadQueueItem).mock.calls[1][0].prepared).toEqual(vi.mocked(uploadQueueItem).mock.calls[0][0].prepared)
  })
})
