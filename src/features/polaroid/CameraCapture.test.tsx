import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../context/LocaleContext'
import { CameraCapture } from './CameraCapture'
import { DEFAULT_PHOTO_CROP, getBoothLayout, getPhotoGeometry } from './render'

function makeStream(facingMode = 'user') {
  const tracks = [
    { stop: vi.fn(), getSettings: () => ({ facingMode }) },
    { stop: vi.fn() },
  ]
  return {
    stream: { getTracks: () => tracks, getVideoTracks: () => [tracks[0]] } as unknown as MediaStream,
    tracks,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const getUserMedia = vi.fn<MediaDevices['getUserMedia']>()
const context = { translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() }

async function renderCamera(options: { shotCount?: 1 | 4; aspectRatio?: number; useOnComplete?: boolean } = {}) {
  const onCapture = vi.fn()
  const onComplete = vi.fn()
  const onClose = vi.fn()
  const result = render(<LocaleProvider><CameraCapture shotCount={options.shotCount} aspectRatio={options.aspectRatio} onComplete={options.shotCount === 4 || options.useOnComplete ? onComplete : undefined} onCapture={onCapture} onClose={onClose} /></LocaleProvider>)
  await act(async () => { await Promise.resolve() })
  return { ...result, onCapture, onComplete, onClose }
}

function fileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

describe('CameraCapture', () => {
  beforeEach(() => {
    getUserMedia.mockReset()
    Object.values(context).forEach((mock) => mock.mockReset())
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('isSecureContext', true)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1920)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1080)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['photo'], { type: 'image/jpeg' })))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('requests only camera video and releases every track and the scroll lock on unmount', async () => {
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    document.body.style.overflow = 'auto'
    const view = await renderCamera()

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 } },
    })
    expect(screen.getByRole('dialog')).toHaveAccessibleName('A little moment, just for you')
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled()
    const video = view.container.querySelector('video')!
    expect(video.srcObject).toBe(stream)
    expect(video).toHaveAttribute('playsinline')
    expect(video.muted).toBe(true)

    view.unmount()

    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(video.srcObject).toBeNull()
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  it('allows Escape while permission is pending and stops a late stream without delivering a photo', async () => {
    const permission = deferred<MediaStream>()
    const { stream, tracks } = makeStream()
    getUserMedia.mockReturnValue(permission.promise)
    const view = await renderCamera()

    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.onClose).toHaveBeenCalledTimes(1)

    await act(async () => { permission.resolve(stream) })

    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(view.container.querySelector('video')!.srcObject).toBeNull()
    expect(view.onCapture).not.toHaveBeenCalled()
    view.unmount()
  })

  it('stops a permission request that resolves after unmount', async () => {
    const permission = deferred<MediaStream>()
    const { stream, tracks } = makeStream()
    getUserMedia.mockReturnValue(permission.promise)
    const view = await renderCamera()
    view.unmount()

    await act(async () => { permission.resolve(stream) })

    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(view.onCapture).not.toHaveBeenCalled()
    expect(view.onClose).not.toHaveBeenCalled()
  })

  it('explains denied permission and opens a fresh stream when retried', async () => {
    const { stream, tracks } = makeStream()
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError')).mockResolvedValueOnce(stream)
    const view = await renderCamera()

    expect(screen.getByRole('alert')).toHaveTextContent('Allow camera access in your browser settings')
    expect(screen.queryByRole('button', { name: 'Take photo' })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try camera again' })) })

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(view.onClose).toHaveBeenCalledTimes(1)
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
  })

  it('counts down three seconds and captures a bounded JPEG with the same mirror transform as the preview', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(3840)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(2160)
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const view = await renderCamera()
    const video = view.container.querySelector('video')!
    expect(video.style.transform).toBe('scaleX(-1)')

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    expect(screen.getByRole('status', { name: 'Photo in 3' })).toHaveTextContent('3')
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('status', { name: 'Photo in 2' })).toHaveTextContent('2')
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('status', { name: 'Photo in 1' })).toHaveTextContent('1')
    expect(view.onCapture).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1000) })

    expect(context.translate).toHaveBeenCalledWith(2400, 0)
    expect(context.scale).toHaveBeenCalledWith(-1, 1)
    expect(context.drawImage).toHaveBeenCalledWith(video, expect.closeTo(480), 0, expect.closeTo(2880), 2160, 0, 0, 2400, 1800)
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92)
    expect(view.onCapture).toHaveBeenCalledTimes(1)
    const file = view.onCapture.mock.calls[0][0] as File
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('wedding-photo.jpg')
    expect(file.type).toBe('image/jpeg')
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(video.srcObject).toBeNull()
  })

  it.each([
    { sensor: 'wide', width: 1920, height: 1080, layout: 'strip' as const, source: [240, 0, 1440, 1080], output: [1440, 1080] },
    { sensor: 'portrait', width: 1080, height: 1920, layout: 'strip' as const, source: [0, 555, 1080, 810], output: [1080, 810] },
    { sensor: '4:3', width: 1600, height: 1200, layout: 'strip' as const, source: [0, 0, 1600, 1200], output: [1600, 1200] },
    { sensor: 'wide', width: 1920, height: 1080, layout: 'grid' as const, source: [420, 0, 1080, 1080], output: [1080, 1080] },
    { sensor: 'portrait', width: 1080, height: 1920, layout: 'single' as const, source: [0, 420, 1080, 1080], output: [1080, 1080] },
  ])('keeps the pose centered from a $sensor sensor through the viewfinder and $layout print', async ({ width, height, layout, source, output }) => {
    vi.useFakeTimers()
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(width)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(height)
    getUserMedia.mockResolvedValue(makeStream().stream)
    const rect = getBoothLayout(layout).photoRects[0]
    const aspectRatio = rect.width / rect.height
    const view = await renderCamera({ aspectRatio })
    const video = view.container.querySelector('video')!
    const viewfinder = video.parentElement!
    expect(Number.parseFloat(viewfinder.style.aspectRatio)).toBeCloseTo(aspectRatio)
    expect(Number.parseFloat(viewfinder.style.maxWidth) / aspectRatio).toBeCloseTo(52)
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ aspectRatio: { ideal: aspectRatio } }) }))

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await act(async () => { vi.advanceTimersByTime(3000) })

    expect(context.drawImage).toHaveBeenCalledWith(video, ...source.map(value => expect.closeTo(value)), 0, 0, ...output)
    const [left, top, cropWidth, cropHeight] = context.drawImage.mock.lastCall!.slice(1, 5) as number[]
    // The live CSS cover crop and saved crop discard equal amounts on opposite
    // sides, including portrait sensors that ignore the requested aspect ratio.
    expect(left + cropWidth / 2).toBeCloseTo(width / 2)
    expect(top + cropHeight / 2).toBeCloseTo(height / 2)
    expect(cropWidth / cropHeight).toBeCloseTo(aspectRatio)
    const printed = getPhotoGeometry(output[0], output[1], DEFAULT_PHOTO_CROP, rect).sourceCrop
    expect(printed.x).toBeCloseTo(0)
    expect(printed.y).toBeCloseTo(0)
    expect(printed.width).toBeCloseTo(output[0])
    expect(printed.height).toBeCloseTo(output[1])
    expect(view.onCapture).toHaveBeenCalledOnce()
  })

  it('leaves a rear-camera fallback unmirrored in both preview and capture', async () => {
    vi.useFakeTimers()
    getUserMedia.mockResolvedValue(makeStream('environment').stream)
    const view = await renderCamera()
    expect(view.container.querySelector('video')!.style.transform).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await act(async () => { vi.advanceTimersByTime(3000) })

    expect(context.translate).not.toHaveBeenCalled()
    expect(context.scale).not.toHaveBeenCalled()
    expect(view.onCapture).toHaveBeenCalledTimes(1)
  })

  it('cancels the countdown without taking a photo, and allows starting again', async () => {
    vi.useFakeTimers()
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const view = await renderCamera()

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await act(async () => { vi.advanceTimersByTime(1000) })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel countdown' }))
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(view.onCapture).not.toHaveBeenCalled()
    expect(context.drawImage).not.toHaveBeenCalled()
    tracks.forEach((track) => expect(track.stop).not.toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close camera' }))
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(view.onCapture).not.toHaveBeenCalled()
    expect(view.onClose).toHaveBeenCalledTimes(1)
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
  })

  it('ignores an encoded photo if the user closes while encoding is pending', async () => {
    vi.useFakeTimers()
    let finishEncoding!: BlobCallback
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => { finishEncoding = callback })
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const view = await renderCamera()

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await act(async () => { vi.advanceTimersByTime(3000) })
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Close camera' }))
    await act(async () => { finishEncoding(new Blob(['photo'], { type: 'image/jpeg' })) })

    expect(view.onCapture).not.toHaveBeenCalled()
    expect(view.onClose).toHaveBeenCalledTimes(1)
  })

  it('releases the stream and offers retry if the frame cannot be encoded', async () => {
    vi.useFakeTimers()
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(null))
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const view = await renderCamera()

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await act(async () => { vi.advanceTimersByTime(3000) })

    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t take that photo')
    expect(screen.getByRole('button', { name: 'Try camera again' })).toBeEnabled()
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(view.onCapture).not.toHaveBeenCalled()
  })

  it('shows Malay guidance and never requests a camera in an insecure context', async () => {
    window.localStorage.setItem('an-gallery-locale', 'ms')
    vi.stubGlobal('isSecureContext', false)
    await renderCamera()

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Kamera tidak tersedia dalam pelayar ini')
    expect(screen.getByRole('button', { name: 'Tutup kamera' })).toBeEnabled()
  })

  it('takes four separate frames with a fresh three-second countdown for each and delivers the ordered set together', async () => {
    vi.useFakeTimers()
    const encoders: BlobCallback[] = []
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => { encoders.push(callback) })
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const view = await renderCamera({ shotCount: 4 })
    const video = view.container.querySelector('video')!

    fireEvent.click(screen.getByRole('button', { name: 'Start 4-photo session' }))
    for (let shot = 1; shot <= 4; shot += 1) {
      expect(screen.getByText(`Photo ${shot} of 4`)).toBeVisible()
      expect(screen.getByRole('status', { name: 'Photo in 3' })).toHaveTextContent('3')
      expect(view.container.querySelectorAll('.camera-shot-indicator.is-complete')).toHaveLength(shot - 1)
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(screen.getByRole('status', { name: 'Photo in 2' })).toHaveTextContent('2')
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(screen.getByRole('status', { name: 'Photo in 1' })).toHaveTextContent('1')
      expect(context.drawImage).toHaveBeenCalledTimes(shot - 1)
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(context.drawImage).toHaveBeenCalledTimes(shot)
      expect(context.drawImage).toHaveBeenNthCalledWith(shot, video, expect.closeTo(240), 0, expect.closeTo(1440), 1080, 0, 0, 1440, 1080)
      expect(view.onComplete).not.toHaveBeenCalled()
      expect(view.onCapture).not.toHaveBeenCalled()

      if (shot < 4) {
        expect(video.srcObject).toBe(stream)
        tracks.forEach((track) => expect(track.stop).not.toHaveBeenCalled())
      }
      // Encoding is asynchronous in a browser: the next timer must wait for this frame.
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(context.drawImage).toHaveBeenCalledTimes(shot)
      await act(async () => { encoders[shot - 1](new Blob([`pose-${shot}`], { type: 'image/jpeg' })) })
    }

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(view.onComplete).toHaveBeenCalledTimes(1)
    expect(view.onCapture).not.toHaveBeenCalled()
    const files = view.onComplete.mock.calls[0][0] as File[]
    expect(files).toHaveLength(4)
    expect(new Set(files).size).toBe(4)
    expect(files.map((file) => file.name)).toEqual(['wedding-photo-1.jpg', 'wedding-photo-2.jpg', 'wedding-photo-3.jpg', 'wedding-photo-4.jpg'])
    expect(files.every((file) => file.type === 'image/jpeg')).toBe(true)
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(video.srcObject).toBeNull()
    vi.useRealTimers()
    expect(await Promise.all(files.map(fileText))).toEqual(['pose-1', 'pose-2', 'pose-3', 'pose-4'])
  })

  it('discards a partially captured session when cancelled between photos', async () => {
    vi.useFakeTimers()
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const view = await renderCamera({ shotCount: 4 })

    fireEvent.click(screen.getByRole('button', { name: 'Start 4-photo session' }))
    await act(async () => { vi.advanceTimersByTime(7000) })
    expect(context.drawImage).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Photo 3 of 4')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel session' }))
    await act(async () => { vi.advanceTimersByTime(15000) })

    expect(context.drawImage).toHaveBeenCalledTimes(2)
    expect(view.onCapture).not.toHaveBeenCalled()
    expect(view.onComplete).not.toHaveBeenCalled()
    expect(view.onClose).toHaveBeenCalledTimes(1)
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
  })

  it('does not restart a cancelled session when a pending frame finishes encoding', async () => {
    vi.useFakeTimers()
    let finishEncoding!: BlobCallback
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => { finishEncoding = callback })
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const view = await renderCamera({ shotCount: 4 })

    fireEvent.click(screen.getByRole('button', { name: 'Start 4-photo session' }))
    await act(async () => { vi.advanceTimersByTime(3000) })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel session' }))
    await act(async () => {
      finishEncoding(new Blob(['cancelled-pose'], { type: 'image/jpeg' }))
      vi.advanceTimersByTime(15000)
    })

    expect(context.drawImage).toHaveBeenCalledTimes(1)
    expect(view.onComplete).not.toHaveBeenCalled()
    expect(view.onCapture).not.toHaveBeenCalled()
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
  })

  it('stops and discards an incomplete set after encoding fails, then retries from the first photo', async () => {
    vi.useFakeTimers()
    const firstCamera = makeStream()
    const retryCamera = makeStream()
    getUserMedia.mockResolvedValueOnce(firstCamera.stream).mockResolvedValueOnce(retryCamera.stream)
    vi.mocked(HTMLCanvasElement.prototype.toBlob)
      .mockImplementationOnce((callback) => callback(new Blob(['discarded-first-pose'], { type: 'image/jpeg' })))
      .mockImplementationOnce((callback) => callback(null))
    const view = await renderCamera({ shotCount: 4 })

    fireEvent.click(screen.getByRole('button', { name: 'Start 4-photo session' }))
    await act(async () => { vi.advanceTimersByTime(6000) })
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t take that photo')
    firstCamera.tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(view.onComplete).not.toHaveBeenCalled()
    expect(view.container.querySelectorAll('.camera-shot-indicator.is-complete')).toHaveLength(0)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try camera again' })) })
    expect(screen.getByText('Photo 1 of 4')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Start 4-photo session' }))
    await act(async () => { vi.advanceTimersByTime(12000) })
    expect(view.onComplete).toHaveBeenCalledTimes(1)
    const files = view.onComplete.mock.calls[0][0] as File[]
    expect(files).toHaveLength(4)
    retryCamera.tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    vi.useRealTimers()
    expect(await Promise.all(files.map(fileText))).toEqual(['photo', 'photo', 'photo', 'photo'])
  })

  it('supports the completion callback for a single retake without also firing the legacy callback', async () => {
    vi.useFakeTimers()
    getUserMedia.mockResolvedValue(makeStream().stream)
    const view = await renderCamera({ shotCount: 1, useOnComplete: true })

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await act(async () => { vi.advanceTimersByTime(3000) })

    expect(view.onComplete).toHaveBeenCalledTimes(1)
    expect(view.onComplete.mock.calls[0][0]).toHaveLength(1)
    expect(view.onCapture).not.toHaveBeenCalled()
  })
})
