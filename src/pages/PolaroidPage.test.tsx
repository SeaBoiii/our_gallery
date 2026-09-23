import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../context/LocaleContext'
import type { LoadedPhoto, PolaroidSettings } from '../features/polaroid/types'
import PolaroidPage from './PolaroidPage'

const engine = vi.hoisted(() => ({ load: vi.fn(), draw: vi.fn(), export: vi.fn(), dispose: vi.fn(), pan: vi.fn(), uploads: vi.fn() }))
vi.mock('../features/polaroid/render', () => ({
  DEFAULT_POLAROID_SETTINGS: { frame: 'ivory', caption: '', celebration: 'both', finish: 'original', zoom: 1, positionX: 0, positionY: 0, rotation: 0 },
  POLAROID_WIDTH: 1200, loadPolaroidPhoto: engine.load, drawPolaroid: engine.draw, exportPolaroid: engine.export, positionDelta: engine.pan,
}))
vi.mock('../features/polaroid/CameraCapture', () => ({ CameraCapture: ({ onCapture }: { onCapture: (file: File) => void }) => <div role="dialog" aria-label="Camera"><button onClick={() => onCapture(new File(['camera'], 'camera.jpg', { type: 'image/jpeg' }))}>Capture test photo</button></div> }))
vi.mock('../components/upload/UploadExperience', () => ({ UploadExperience: ({ open, initialFiles, onClose }: { open: boolean; initialFiles: File[]; onClose: () => void }) => {
  if (!open) return null
  engine.uploads(initialFiles)
  return <div role="dialog" aria-label="Gallery upload"><p>{initialFiles[0]?.name}</p><button onClick={onClose}>Close gallery upload</button></div>
} }))
const goodPhoto = () => ({ source: document.createElement('canvas'), width: 1600, height: 1200, dispose: vi.fn() }) satisfies LoadedPhoto
const file = (name = 'photo.jpg') => new File(['photo'], name, { type: 'image/jpeg' })
const chooser = () => document.querySelector<HTMLInputElement>('input[type=file]')!
function setup() {
  const user = userEvent.setup()
  const view = render(<LocaleProvider><MemoryRouter initialEntries={['/polaroid']}><PolaroidPage /></MemoryRouter></LocaleProvider>)
  return { user, ...view }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks()
  engine.load.mockResolvedValue(goodPhoto())
  engine.draw.mockResolvedValue(undefined)
  engine.export.mockResolvedValue(new Blob(['rendered-frame'], { type: 'image/png' }))
  engine.pan.mockReturnValue({ positionX: .2, positionY: -.1 })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:keepsake'); static revokeObjectURL = vi.fn() })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Polaroid studio', () => {
  it('keeps photos local and exports the selected frame, caption and crop into the existing upload flow', async () => {
    const { user } = setup()
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeDisabled()
    await user.upload(chooser(), file())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled())
    expect(engine.export).not.toHaveBeenCalled()
    expect(engine.uploads).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Love, airmail' }))
    await user.type(screen.getByLabelText(/A little caption/), 'Our favourite adventure')
    await user.selectOptions(screen.getByLabelText('The celebration'), 'reception')
    await user.click(screen.getByRole('button', { name: 'Black & white' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.5' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to gallery' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Add to gallery' }))
    expect(await screen.findByRole('dialog', { name: 'Gallery upload' })).toBeInTheDocument()
    expect(engine.export).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ frame: 'airmail', caption: 'Our favourite adventure', celebration: 'reception', finish: 'mono', zoom: 1.5 }))
    const uploaded = engine.uploads.mock.lastCall![0][0] as File
    expect(uploaded.type).toBe('image/png')
    expect(uploaded.size).toBe(14)
    expect(uploaded.name).toMatch(/^aleem-nurulain-airmail-\d+\.png$/)
  })

  it('rejects unsupported or oversized replacements without losing an existing photo', async () => {
    const { user } = setup()
    await user.upload(chooser(), file())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled())
    fireEvent.change(chooser(), { target: { files: [new File(['clip'], 'clip.mp4', { type: 'video/mp4' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPG, PNG, WebP or HEIC photo.')
    expect(engine.load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled()
    const oversized = file('large.jpg')
    Object.defineProperty(oversized, 'size', { value: 26 * 1024 * 1024 })
    fireEvent.change(chooser(), { target: { files: [oversized] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a photo smaller than 25 MB.')
    expect(engine.load).toHaveBeenCalledTimes(1)
  })

  it('disposes stale decodes and aborts the old preview before replacing its image', async () => {
    const older = deferred<LoadedPhoto>()
    const stale = goodPhoto()
    const latest = goodPhoto()
    const replacement = goodPhoto()
    engine.load.mockReturnValueOnce(older.promise).mockResolvedValueOnce(latest).mockResolvedValueOnce(replacement)
    const { unmount } = setup()
    fireEvent.change(chooser(), { target: { files: [file('older.jpg')] } })
    fireEvent.change(chooser(), { target: { files: [file('newer.jpg')] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled())
    await act(async () => older.resolve(stale))
    expect(stale.dispose).toHaveBeenCalledOnce()
    const previousSignal = engine.draw.mock.lastCall![3].signal as AbortSignal
    latest.dispose.mockImplementation(() => { expect(previousSignal.aborted).toBe(true) })
    fireEvent.change(chooser(), { target: { files: [file('replacement.jpg')] } })
    await waitFor(() => expect(latest.dispose).toHaveBeenCalledOnce())
    unmount()
    expect(replacement.dispose).toHaveBeenCalledOnce()
  })

  it('locks edits during export and drops a late export after leaving the page', async () => {
    const pending = deferred<Blob>()
    engine.export.mockReturnValue(pending.promise)
    const { user, unmount } = setup()
    await user.upload(chooser(), file())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Save PNG' }))
    expect(screen.getByLabelText(/A little caption/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add to gallery' })).toBeDisabled()
    fireEvent.change(chooser(), { target: { files: [file('ignored.jpg')] } })
    expect(engine.load).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => pending.resolve(new Blob(['late'])))
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(engine.uploads).not.toHaveBeenCalled()
  })

  it('accepts a camera capture and preserves edits when switching language', async () => {
    const { user } = setup()
    await user.click(within(screen.getByRole('region', { name: 'Your photograph' })).getByRole('button', { name: 'Open camera' }))
    await user.click(screen.getByRole('button', { name: 'Capture test photo' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled())
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument()
    expect(engine.load.mock.lastCall![0].name).toBe('camera.jpg')
    await user.type(screen.getByLabelText(/A little caption/), 'Forever')
    await user.click(screen.getByRole('button', { name: 'Tukar ke Bahasa Melayu' }))
    expect(screen.getByLabelText(/Kapsyen ringkas/)).toHaveValue('Forever')
    expect(screen.getByRole('button', { name: 'Simpan PNG' })).toBeInTheDocument()
    expect(engine.load).toHaveBeenCalledTimes(1)
  })

  it('uses keyboard crop controls and makes a downloadable PNG without uploading', async () => {
    const { user } = setup()
    await user.upload(chooser(), file())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled())
    const crop = document.querySelector<HTMLElement>('.studio-drag-surface')!
    fireEvent.keyDown(crop, { key: 'ArrowRight' })
    expect(engine.pan).toHaveBeenCalledWith(expect.anything(), expect.anything(), 35, 0)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Save PNG' }))
    expect(await screen.findByText('Your keepsake is ready. Check your downloads.')).toBeInTheDocument()
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(engine.export.mock.lastCall![1] as PolaroidSettings).toMatchObject({ positionX: .2, positionY: -.1 })
    expect(engine.uploads).not.toHaveBeenCalled()
  })
})
