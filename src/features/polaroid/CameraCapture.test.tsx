import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../context/LocaleContext'
import { CameraCapture } from './CameraCapture'

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

async function renderCamera() {
  const onCapture = vi.fn()
  const onClose = vi.fn()
  const result = render(<LocaleProvider><CameraCapture onCapture={onCapture} onClose={onClose} /></LocaleProvider>)
  await act(async () => { await Promise.resolve() })
  return { ...result, onCapture, onClose }
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
      video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
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
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 2400, 1350)
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92)
    expect(view.onCapture).toHaveBeenCalledTimes(1)
    const file = view.onCapture.mock.calls[0][0] as File
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('wedding-photo.jpg')
    expect(file.type).toBe('image/jpeg')
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(video.srcObject).toBeNull()
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
})
