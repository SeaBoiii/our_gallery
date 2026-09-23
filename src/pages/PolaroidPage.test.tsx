import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../context/LocaleContext'
import { GalleryVisibilityContext, type GalleryVisibilityContextValue } from '../context/gallery-visibility-context'
import type { EventSlug, PublicGalleryConfig } from '../../shared/contracts'
import { DEFAULT_PHOTO_CROP, getBoothLayout } from '../features/polaroid/render'
import type { BoothLayout, BoothPhoto, BoothSettings, LoadedPhoto } from '../features/polaroid/types'
import PolaroidPage from './PolaroidPage'

const engine = vi.hoisted(() => ({ load: vi.fn(), draw: vi.fn(), export: vi.fn(), pan: vi.fn(), uploads: vi.fn(), refresh: vi.fn() }))
vi.mock('../features/polaroid/render', async importOriginal => {
  const actual = await importOriginal<typeof import('../features/polaroid/render')>()
  return { ...actual, loadPolaroidPhoto: engine.load, drawPhotobooth: engine.draw, exportPhotobooth: engine.export, boothPositionDelta: engine.pan }
})
vi.mock('../features/polaroid/CameraCapture', () => ({
  CameraCapture: ({ shotCount = 1, onComplete, onClose }: { shotCount?: 1 | 4; onComplete: (files: File[]) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Camera">
      <button onClick={() => onComplete(Array.from({ length: shotCount }, (_, index) => new File([`camera-${index + 1}`], `camera-${index + 1}.jpg`, { type: 'image/jpeg' })))}>Complete {shotCount}-photo camera session</button>
      <button onClick={onClose}>Cancel camera session</button>
    </div>
  ),
}))
vi.mock('../components/upload/UploadExperience', () => ({
  UploadExperience: ({ open, initialFiles, lockedEventSlug, onClose }: { open: boolean; initialFiles: File[]; lockedEventSlug?: EventSlug; onClose: () => void }) => {
    if (!open) return null
    engine.uploads(initialFiles, lockedEventSlug)
    return <div role="dialog" aria-label="Gallery upload"><p>{initialFiles[0]?.name}</p><p data-testid="locked-upload-date">{lockedEventSlug}</p><button onClick={onClose}>Close gallery upload</button></div>
  },
}))

const goodPhoto = () => ({ source: document.createElement('canvas'), width: 1600, height: 1200, dispose: vi.fn() }) satisfies LoadedPhoto
const file = (name = 'photo.jpg') => new File([name], name, { type: 'image/jpeg' })
const chooser = () => document.querySelector<HTMLInputElement>('input[type=file]')!
const drawnPhotos = () => engine.draw.mock.lastCall![1] as (BoothPhoto | null)[]
const drawnSettings = () => engine.draw.mock.lastCall![2] as BoothSettings
const savedPhotos = () => engine.export.mock.lastCall![0] as BoothPhoto[]
const ready = () => waitFor(() => expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled())

function policy(mode: PublicGalleryConfig['mode'] = 'solemnisation', revision = 'revision-1'): PublicGalleryConfig {
  const events = (['solemnisation', 'reception'] as const).filter(slug => mode === 'both' || slug === mode).map(slug => ({
    id: `event-${slug}`, slug, name: slug, eventDate: slug === 'solemnisation' ? '2027-08-21' : '2027-08-22', displayName: slug, uploadEnabled: true,
  }))
  return { mode, revision, events, uploadsEnabled: true, serverTime: '2027-08-21T00:00:00.000Z', validUntil: '2027-08-21T00:00:30.000Z', nextTransitionAt: null }
}

function setup(initialConfig: PublicGalleryConfig | null = policy()) {
  const user = userEvent.setup()
  let config = initialConfig
  let status: GalleryVisibilityContextValue['status'] = config ? 'ready' : 'loading'
  engine.refresh.mockImplementation(async () => {
    if (!config || status !== 'ready') throw new Error('Visibility unavailable')
    return config
  })
  const tree = () => <LocaleProvider><GalleryVisibilityContext.Provider value={{ config, status, refresh: engine.refresh }}><MemoryRouter initialEntries={['/photobooth']}><PolaroidPage /></MemoryRouter></GalleryVisibilityContext.Provider></LocaleProvider>
  const view = render(tree())
  const changeVisibility = (next: PublicGalleryConfig | null, nextStatus: GalleryVisibilityContextValue['status'] = next ? 'ready' : 'error') => {
    config = next; status = nextStatus; view.rerender(tree())
  }
  return { user, ...view, changeVisibility }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function queuePhotos(count = 4) {
  const photos = Array.from({ length: count }, goodPhoto)
  photos.forEach(photo => engine.load.mockResolvedValueOnce(photo))
  return photos
}

async function fillFour(user: ReturnType<typeof userEvent.setup>) {
  const photos = queuePhotos()
  const files = Array.from({ length: 4 }, (_, index) => file(`pose-${index + 1}.jpg`))
  await user.upload(chooser(), files)
  await ready()
  return { photos, files }
}

beforeEach(() => {
  vi.resetAllMocks()
  engine.load.mockImplementation(async () => goodPhoto())
  engine.draw.mockResolvedValue(undefined)
  engine.export.mockResolvedValue(new Blob(['rendered-frame'], { type: 'image/png' }))
  engine.pan.mockReturnValue({ positionX: 0.2, positionY: -0.1 })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:keepsake'); static revokeObjectURL = vi.fn() })
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Wedding photo booth', () => {
  it('starts with a four-photo strip and keeps export disabled until every frame is filled', async () => {
    const { user } = setup()
    expect(screen.getByRole('button', { name: /^Classic strip/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: /Your photo booth preview/ })).toHaveAttribute('width', '900')
    expect(screen.getByRole('img', { name: /Your photo booth preview/ })).toHaveAttribute('height', '2700')
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add to gallery' })).toBeDisabled()
    const firstThree = queuePhotos(3)
    await user.upload(chooser(), [file('first.jpg'), file('second.jpg'), file('third.jpg')])
    await screen.findByRole('button', { name: 'Photo 3' })
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add to gallery' })).toBeDisabled()

    const fourth = queuePhotos(1)[0]
    await user.upload(chooser(), file('fourth.jpg'))
    await ready()

    expect(drawnPhotos().map(entry => entry?.photo)).toEqual([...firstThree, fourth])
    expect(engine.load.mock.calls.map(([input]) => input.name)).toEqual(['first.jpg', 'second.jpg', 'third.jpg', 'fourth.jpg'])
    expect(engine.export).not.toHaveBeenCalled()
    expect(engine.uploads).not.toHaveBeenCalled()
  })

  it('preserves the order of four uploaded photos and sends the composed PNG to the gallery only when requested', async () => {
    const { user, changeVisibility } = setup()
    const { photos, files } = await fillFour(user)
    expect(engine.load.mock.calls.map(([input]) => input)).toEqual(files)
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    await user.click(screen.getByRole('button', { name: 'Love, airmail' }))
    await user.type(screen.getByLabelText(/A little caption/), 'Our favourite adventure')
    changeVisibility(policy('both'))
    await user.selectOptions(screen.getByLabelText('Wedding date'), 'reception')
    await user.click(screen.getByRole('button', { name: 'Black & white' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.5' } })
    await ready()
    expect(engine.export).not.toHaveBeenCalled()
    expect(engine.uploads).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Add to gallery' }))

    expect(await screen.findByRole('dialog', { name: 'Gallery upload' })).toBeInTheDocument()
    expect(engine.export).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ layout: 'strip', frame: 'airmail', caption: 'Our favourite adventure', celebration: 'reception', finish: 'mono' }))
    expect(savedPhotos().map(entry => entry.photo)).toEqual(photos)
    expect(savedPhotos()[0].crop.zoom).toBe(1.5)
    expect(savedPhotos().slice(1).every(entry => entry.crop.zoom === 1)).toBe(true)
    const uploaded = engine.uploads.mock.lastCall![0][0] as File
    expect(uploaded.type).toBe('image/png')
    expect(uploaded.size).toBe(14)
    expect(uploaded.name).toMatch(/^aleem-nurulain-strip-airmail-\d+\.png$/)
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  })

  it('retains all four originals and their independent crops while switching through the single-photo option', async () => {
    const { user } = setup()
    const { photos } = await fillFour(user)
    await user.click(screen.getByRole('button', { name: 'Photo 3' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } })
    await user.click(screen.getByRole('button', { name: 'Rotate photo' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Left / right' }), { target: { value: '0.4' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Up / down' }), { target: { value: '-0.2' } })
    await ready()

    await user.click(screen.getByRole('button', { name: /^One Polaroid/ }))
    await ready()
    expect(screen.queryByRole('button', { name: 'Photo 3' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photo 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('1')
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.4' } })
    await user.click(screen.getByRole('button', { name: /^Four-frame print/ }))
    await user.click(screen.getByRole('button', { name: 'Photo 3' }))
    await ready()

    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('2')
    expect(screen.getByRole('slider', { name: 'Left / right' })).toHaveValue('0.4')
    expect(screen.getByRole('slider', { name: 'Up / down' })).toHaveValue('-0.2')
    expect(drawnPhotos()[2]?.crop).toEqual({ zoom: 2, positionX: 0.4, positionY: -0.2, rotation: 90 })
    expect(drawnPhotos()[0]?.crop.zoom).toBe(1.4)
    await user.click(screen.getByRole('button', { name: /^Classic strip/ }))
    await ready()
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    expect(drawnPhotos()[2]?.crop.rotation).toBe(90)
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
    expect(engine.load).toHaveBeenCalledTimes(4)
  })

  it('retakes only the selected photograph and resets only that photograph’s crop', async () => {
    const { user } = setup()
    const { photos } = await fillFour(user)
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.3' } })
    await user.click(screen.getByRole('button', { name: 'Photo 2' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } })
    const replacement = queuePhotos(1)[0]
    await user.click(screen.getByRole('button', { name: 'Retake photo' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Camera' })).getByRole('button', { name: 'Complete 1-photo camera session' }))
    await ready()

    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument()
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual([photos[0], replacement, photos[2], photos[3]])
    expect(drawnPhotos()[0]?.crop.zoom).toBe(1.3)
    expect(drawnPhotos()[1]?.crop).toEqual(DEFAULT_PHOTO_CROP)
    expect(screen.getByRole('button', { name: 'Photo 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(engine.load.mock.lastCall![0].name).toBe('camera-1.jpg')
    expect(photos[1].dispose).toHaveBeenCalledOnce()
    ;[photos[0], photos[2], photos[3]].forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })

  it('moves the crop with its photograph when reordering shots', async () => {
    const { user } = setup()
    const { photos } = await fillFour(user)
    await user.click(screen.getByRole('button', { name: 'Photo 2' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.7' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Left / right' }), { target: { value: '0.2' } })
    await user.click(screen.getByRole('button', { name: 'Move earlier' }))
    await ready()

    expect(drawnPhotos().map(entry => entry?.photo)).toEqual([photos[1], photos[0], photos[2], photos[3]])
    expect(drawnPhotos()[0]?.crop).toMatchObject({ zoom: 1.7, positionX: 0.2 })
    expect(drawnPhotos()[1]?.crop).toEqual(DEFAULT_PHOTO_CROP)
    expect(screen.getByRole('button', { name: 'Photo 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Move earlier' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move later' }))
    await ready()
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    expect(drawnPhotos()[1]?.crop.zoom).toBe(1.7)
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
    expect(engine.load).toHaveBeenCalledTimes(4)
  })

  it('rejects invalid, oversized or overfull batches without decoding or replacing existing photographs', async () => {
    const { user } = setup()
    const { photos } = await fillFour(user)
    const invalid = new File(['clip'], 'clip.mp4', { type: 'video/mp4' })
    fireEvent.change(chooser(), { target: { files: [file('valid.jpg'), invalid] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPG, PNG, WebP or HEIC photo.')
    const oversized = file('large.jpg')
    Object.defineProperty(oversized, 'size', { value: 26 * 1024 * 1024 })
    fireEvent.change(chooser(), { target: { files: [oversized] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a photo smaller than 25 MB.')
    fireEvent.change(chooser(), { target: { files: Array.from({ length: 5 }, (_, index) => file(`${index}.jpg`)) } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose up to four photos at a time')

    expect(engine.load).toHaveBeenCalledTimes(4)
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled()
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })

  it('disposes partially decoded replacements after a batch failure and keeps the complete previous set', async () => {
    const { user } = setup()
    const { photos } = await fillFour(user)
    const partial = goodPhoto()
    engine.load.mockResolvedValueOnce(partial).mockRejectedValueOnce(new Error('Bad image data'))
    await user.upload(chooser(), [file('partial.jpg'), file('corrupt.jpg'), file('third.jpg'), file('fourth.jpg')])

    expect(await screen.findByRole('alert')).toHaveTextContent('This photo could not be opened')
    expect(partial.dispose).toHaveBeenCalledOnce()
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeEnabled()
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })

  it('rejects a partial batch that would overwrite occupied frames but allows replacing the complete set', async () => {
    const { user } = setup()
    const original = queuePhotos(3)
    await user.upload(chooser(), [file('first.jpg'), file('second.jpg'), file('third.jpg')])
    await waitFor(() => expect(drawnPhotos().filter(Boolean)).toHaveLength(3))
    await user.upload(chooser(), [file('extra-one.jpg'), file('extra-two.jpg')])

    expect(screen.getByRole('alert')).toHaveTextContent('There are not enough empty frames')
    expect(engine.load).toHaveBeenCalledTimes(3)
    expect(drawnPhotos().map(entry => entry?.photo ?? null)).toEqual([...original, null])
    original.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())

    const replacement = queuePhotos()
    await user.upload(chooser(), Array.from({ length: 4 }, (_, index) => file(`full-replacement-${index}.jpg`)))
    await ready()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(replacement)
    original.forEach(photo => expect(photo.dispose).toHaveBeenCalledOnce())
    replacement.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })

  it('shows a failed preview beside the canvas and retries without losing the photos or selected frame', async () => {
    const { user } = setup()
    const { photos } = await fillFour(user)
    engine.draw.mockRejectedValueOnce(new Error('Canvas unavailable'))
    await user.click(screen.getByRole('button', { name: 'Love, airmail' }))
    const preview = within(screen.getByRole('region', { name: 'Your photo booth preview' }))

    expect(await preview.findByRole('alert')).toHaveTextContent('The preview could not be prepared')
    expect(screen.queryByText('Developing your preview…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeDisabled()
    await user.click(preview.getByRole('button', { name: 'Try again' }))
    await ready()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    expect(drawnSettings().frame).toBe('airmail')
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
    expect(engine.export).not.toHaveBeenCalled()
  })

  it('disposes every stale batch decode without overwriting a newer complete selection', async () => {
    const older = deferred<LoadedPhoto>()
    const staleFirst = goodPhoto()
    const staleSecond = goodPhoto()
    engine.load.mockResolvedValueOnce(staleFirst).mockReturnValueOnce(older.promise)
    const { unmount } = setup()
    fireEvent.change(chooser(), { target: { files: [file('older-1.jpg'), file('older-2.jpg')] } })
    await waitFor(() => expect(engine.load).toHaveBeenCalledTimes(2))
    const latest = queuePhotos()
    fireEvent.change(chooser(), { target: { files: Array.from({ length: 4 }, (_, index) => file(`newer-${index}.jpg`)) } })
    await ready()
    await act(async () => { older.resolve(staleSecond) })

    expect(staleFirst.dispose).toHaveBeenCalledOnce()
    expect(staleSecond.dispose).toHaveBeenCalledOnce()
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(latest)
    latest.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
    unmount()
    latest.forEach(photo => expect(photo.dispose).toHaveBeenCalledOnce())
  })

  it('aborts the previous preview before disposing a replaced photo, and aborts again before unmount cleanup', async () => {
    const { user, unmount } = setup()
    const { photos } = await fillFour(user)
    const previousSignal = engine.draw.mock.lastCall![3].signal as AbortSignal
    photos[1].dispose.mockImplementation(() => { expect(previousSignal.aborted).toBe(true) })
    await user.click(screen.getByRole('button', { name: 'Photo 2' }))
    await user.click(screen.getByRole('button', { name: 'Replace photo' }))
    const replacement = queuePhotos(1)[0]
    await user.upload(chooser(), file('replacement.jpg'))
    await ready()
    expect(photos[1].dispose).toHaveBeenCalledOnce()
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual([photos[0], replacement, photos[2], photos[3]])

    const currentSignal = engine.draw.mock.lastCall![3].signal as AbortSignal
    const current = [photos[0], replacement, photos[2], photos[3]]
    current.forEach(photo => photo.dispose.mockImplementation(() => { expect(currentSignal.aborted).toBe(true) }))
    unmount()
    current.forEach(photo => expect(photo.dispose).toHaveBeenCalledOnce())
    expect(photos[1].dispose).toHaveBeenCalledOnce()
  })

  it.each(['Save PNG', 'Add to gallery'])('locks edits during %s and ignores a late export after leaving the page', async destination => {
    const pending = deferred<Blob>()
    engine.export.mockReturnValue(pending.promise)
    const { user, unmount, container } = setup()
    const { photos } = await fillFour(user)
    await user.click(screen.getByRole('button', { name: destination }))

    expect(screen.getByLabelText(/A little caption/)).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Zoom' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retake photo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Four-frame print/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add to gallery' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start photo booth' })).toBeDisabled()
    fireEvent.change(chooser(), { target: { files: [file('ignored.jpg')] } })
    fireEvent.keyDown(container.querySelector('.studio-drag-surface')!, { key: 'ArrowRight' })
    expect(engine.load).toHaveBeenCalledTimes(4)
    expect(engine.pan).not.toHaveBeenCalled()
    unmount()
    photos.forEach(photo => expect(photo.dispose).toHaveBeenCalledOnce())
    await act(async () => { pending.resolve(new Blob(['late'])) })

    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(engine.uploads).not.toHaveBeenCalled()
  })

  it('accepts the four-shot camera result and preserves photographs, layout, details and crops across a language change', async () => {
    const { user } = setup()
    const photos = queuePhotos()
    await user.click(screen.getByRole('button', { name: 'Start photo booth' }))
    await user.click(screen.getByRole('button', { name: 'Complete 4-photo camera session' }))
    await ready()
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument()
    expect(engine.load.mock.calls.map(([input]) => input.name)).toEqual(['camera-1.jpg', 'camera-2.jpg', 'camera-3.jpg', 'camera-4.jpg'])
    await user.type(screen.getByLabelText(/A little caption/), 'Forever')
    await user.click(screen.getByRole('button', { name: /^Four-frame print/ }))
    await user.click(screen.getByRole('button', { name: 'Above the clouds' }))
    await user.click(screen.getByRole('button', { name: 'Photo 3' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.8' } })
    await ready()
    await user.click(screen.getByRole('button', { name: 'Tukar ke Bahasa Melayu' }))

    expect(screen.getByLabelText(/Kapsyen ringkas/)).toHaveValue('Forever')
    expect(screen.getByRole('button', { name: 'Simpan PNG' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Cetakan empat foto/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Di atas awan' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('slider', { name: 'Zum' })).toHaveValue('1.8')
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    expect(drawnSettings()).toMatchObject({ layout: 'grid', frame: 'clouds', caption: 'Forever' })
    expect(engine.load).toHaveBeenCalledTimes(4)
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })

  it.each<{ layout: BoothLayout; label: RegExp; index: number }>([
    { layout: 'strip', label: /^Classic strip/, index: 2 },
    { layout: 'grid', label: /^Four-frame print/, index: 3 },
    { layout: 'single', label: /^One Polaroid/, index: 0 },
  ])('pans only the focused photo using its $layout frame rectangle', async ({ layout, label, index }) => {
    const { user, container } = setup()
    const { photos } = await fillFour(user)
    await user.click(screen.getByRole('button', { name: label }))
    await ready()
    const cropSurface = container.querySelectorAll<HTMLElement>('.studio-drag-surface')[index]
    expect(cropSurface).toHaveAccessibleName(`Fine-tune the photo ${index + 1}`)
    fireEvent.focus(cropSurface)
    fireEvent.keyDown(cropSurface, { key: 'ArrowRight' })
    await ready()

    expect(engine.pan).toHaveBeenCalledWith(photos[index], DEFAULT_PHOTO_CROP, getBoothLayout(layout).photoRects[index], 35, 0)
    expect(drawnPhotos()[index]?.crop).toMatchObject({ positionX: 0.2, positionY: -0.1 })
    drawnPhotos().forEach((entry, photoIndex) => {
      if (photoIndex !== index) expect(entry?.crop).toEqual(DEFAULT_PHOTO_CROP)
    })
  })

  it('downloads the complete composed PNG without opening or submitting to the gallery', async () => {
    const { user } = setup()
    const { photos } = await fillFour(user)
    await user.click(screen.getByRole('button', { name: 'Save PNG' }))

    expect(await screen.findByText('Your keepsake is ready. Check your downloads.')).toBeInTheDocument()
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(savedPhotos().map(entry => entry.photo)).toEqual(photos)
    expect(engine.export.mock.lastCall![1]).toMatchObject({ layout: 'strip', frame: 'ivory' })
    expect(engine.uploads).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Gallery upload' })).not.toBeInTheDocument()
  })

  it('requires one explicit date in both-day mode and never offers a combined print date', async () => {
    const { user } = setup(policy('both'))
    const photos = queuePhotos()
    await user.upload(chooser(), Array.from({ length: 4 }, (_, index) => file(`both-days-${index}.jpg`)))
    await screen.findByRole('button', { name: 'Photo 4' })
    const date = screen.getByRole('combobox', { name: 'Wedding date' })

    expect(date).toHaveValue('')
    expect(within(date).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', 'solemnisation', 'reception'])
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add to gallery' })).toBeDisabled()
    expect(screen.getByText('Choose a date for your keepsake before saving.')).toBeVisible()
    expect(engine.export).not.toHaveBeenCalled()
    await user.selectOptions(date, 'reception')
    await ready()
    await user.click(screen.getByRole('button', { name: 'Save PNG' }))

    expect(await screen.findByText('Your keepsake is ready. Check your downloads.')).toBeVisible()
    expect(engine.export.mock.lastCall![1].celebration).toBe('reception')
    expect(savedPhotos().map(entry => entry.photo)).toEqual(photos)
    expect(engine.refresh).toHaveBeenCalledTimes(2)
  })

  it('shows only the active date in single-day mode and preserves a chosen date and all edits across visibility changes', async () => {
    const { user, changeVisibility, container } = setup(policy('both'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Wedding date' }), 'reception')
    const { photos } = await fillFour(user)
    await user.type(screen.getByLabelText(/A little caption/), 'Forever')
    await user.click(screen.getByRole('button', { name: 'Photo 3' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.8' } })
    changeVisibility(policy('solemnisation', 'revision-2'))
    await ready()

    expect(screen.queryByRole('combobox', { name: 'Wedding date' })).not.toBeInTheDocument()
    expect(container.querySelector('.studio-intro .eyebrow')).toHaveTextContent('21 August 2027')
    expect(container.querySelector('.studio-intro .eyebrow')).not.toHaveTextContent('22 August')
    expect(drawnSettings().celebration).toBe('solemnisation')
    expect(screen.getByLabelText(/A little caption/)).toHaveValue('Forever')
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('1.8')
    changeVisibility(policy('both', 'revision-3'))
    await ready()

    expect(screen.getByRole('combobox', { name: 'Wedding date' })).toHaveValue('solemnisation')
    expect(drawnSettings().celebration).toBe('solemnisation')
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    expect(drawnPhotos()[2]?.crop.zoom).toBe(1.8)
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })

  it('preserves an automatically assigned 22 August date through temporary policy loss and a later both-day policy', async () => {
    const { user, changeVisibility } = setup(policy('reception'))
    const { photos } = await fillFour(user)
    expect(drawnSettings().celebration).toBe('reception')
    changeVisibility(null, 'loading')
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeDisabled()
    changeVisibility(policy('both', 'revision-2'))
    await ready()

    expect(screen.getByRole('combobox', { name: 'Wedding date' })).toHaveValue('reception')
    expect(drawnSettings().celebration).toBe('reception')
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })

  it('waits for a fresh date policy before rendering and rejects a date that changed during the preflight', async () => {
    const pending = deferred<PublicGalleryConfig>()
    const { user, changeVisibility } = setup()
    const { photos } = await fillFour(user)
    await user.type(screen.getByLabelText(/A little caption/), 'Our keepsake')
    await ready()
    engine.refresh.mockReturnValueOnce(pending.promise)
    await user.click(screen.getByRole('button', { name: 'Save PNG' }))
    expect(engine.export).not.toHaveBeenCalled()
    const changed = policy('reception', 'revision-2')
    await act(async () => { changeVisibility(changed); pending.resolve(changed) })

    expect(await screen.findByRole('alert')).toHaveTextContent('The available wedding date changed')
    expect(engine.export).not.toHaveBeenCalled()
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/A little caption/)).toHaveValue('Our keepsake')
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })

  it.each(['preflight', 'postflight'])('keeps the entire draft and rejects the print when the %s date check fails', async phase => {
    const { user, changeVisibility } = setup()
    const { photos } = await fillFour(user)
    await user.type(screen.getByLabelText(/A little caption/), 'Safe on this device')
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.6' } })
    await ready()
    if (phase === 'postflight') engine.refresh.mockResolvedValueOnce(policy())
    engine.refresh.mockImplementationOnce(async () => { changeVisibility(null, 'error'); throw new Error('Offline') })
    await user.click(screen.getByRole('button', { name: 'Save PNG' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your photos and edits are safe')
    expect(engine.export).toHaveBeenCalledTimes(phase === 'preflight' ? 0 : 1)
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(engine.uploads).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeDisabled()
    expect(screen.getByLabelText(/A little caption/)).toHaveValue('Safe on this device')
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('1.6')
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
    changeVisibility(policy('solemnisation', 'revision-2'))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await ready()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    { destination: 'Save PNG', nextMode: 'solemnisation' as const },
    { destination: 'Add to gallery', nextMode: 'reception' as const },
  ])('discards a finished $destination export when the policy revision changes during rendering', async ({ destination, nextMode }) => {
    const pending = deferred<Blob>()
    const { user, changeVisibility } = setup()
    const { photos } = await fillFour(user)
    engine.export.mockReturnValueOnce(pending.promise)
    await user.click(screen.getByRole('button', { name: destination }))
    expect(engine.export).toHaveBeenCalledOnce()
    changeVisibility(policy(nextMode, 'revision-2'))
    await act(async () => { pending.resolve(new Blob(['stale print'], { type: 'image/png' })) })

    expect(await screen.findByRole('alert')).toHaveTextContent('The available wedding date changed')
    expect(engine.refresh).toHaveBeenCalledTimes(2)
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(engine.uploads).not.toHaveBeenCalled()
    expect(drawnPhotos().map(entry => entry?.photo)).toEqual(photos)
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })

  it('locks the gallery upload to the date burned into its PNG even if the editor date changes later', async () => {
    const { user, changeVisibility } = setup(policy('both'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Wedding date' }), 'reception')
    const { photos } = await fillFour(user)
    await user.click(screen.getByRole('button', { name: 'Add to gallery' }))

    expect(await screen.findByRole('dialog', { name: 'Gallery upload' })).toBeVisible()
    expect(screen.getByTestId('locked-upload-date')).toHaveTextContent('reception')
    expect(engine.export.mock.lastCall![1].celebration).toBe('reception')
    changeVisibility(policy('solemnisation', 'revision-2'))
    await waitFor(() => expect(drawnSettings().celebration).toBe('solemnisation'))

    expect(screen.getByTestId('locked-upload-date')).toHaveTextContent('reception')
    expect(engine.uploads.mock.lastCall![1]).toBe('reception')
    expect(engine.export).toHaveBeenCalledOnce()
    photos.forEach(photo => expect(photo.dispose).not.toHaveBeenCalled())
  })
})
