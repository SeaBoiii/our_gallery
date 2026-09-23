import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompleteUploadResponse, GalleryEvent, PrepareUploadRequest, PrepareUploadResponse } from '../../../shared/contracts'
import { LocaleProvider } from '../../context/LocaleContext'
import { copy } from '../../i18n/copy'
import { GalleryApiError, getEvents, prepareUploads } from '../../services/api'
import { UploadTransferError, uploadQueueItem } from '../../services/upload'
import { UploadExperience } from './UploadExperience'

vi.mock('../../config', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../config')>(),
  USE_MOCK_DATA: false,
  TURNSTILE_SITE_KEY: 'test-site-key',
}))

vi.mock('../../services/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/api')>(),
  getEvents: vi.fn(),
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

function mount(files: File[] = []) {
  const props = { open: true, initialFiles: files, onClose: vi.fn(), onViewGallery: vi.fn() }
  const tree = (open = true) => <LocaleProvider><UploadExperience {...props} open={open} /></LocaleProvider>
  const result = render(tree())
  return { ...result, ...props, reopen: () => result.rerender(tree()), hide: () => result.rerender(tree(false)) }
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
  vi.mocked(getEvents).mockResolvedValue(events)
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
    expect(widgets).toHaveLength(2)
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
