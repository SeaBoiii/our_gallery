import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Camera, RotateCcw, X } from 'lucide-react'
import { useLocale } from '../../context/useLocale'
import { useModalFocus } from '../../hooks/useModalFocus'

type Props = {
  onCapture: (file: File) => void
  onClose: () => void
}

type CameraError = 'permission' | 'unavailable' | 'busy' | 'capture'
type CameraStatus = 'loading' | 'ready' | 'capturing' | 'error'

const messages = {
  en: {
    title: 'A little moment, just for you',
    description: 'Find your light. Your photo will be taken after a 3-second countdown.',
    close: 'Close camera',
    loading: 'Opening your camera…',
    shutter: 'Take photo',
    capturing: 'Making your photo…',
    cancel: 'Cancel',
    cancelCountdown: 'Cancel countdown',
    retry: 'Try camera again',
    countdown: (seconds: number) => `Photo in ${seconds}`,
    preview: 'Live camera preview',
    errors: {
      permission: 'Camera access is turned off. Allow camera access in your browser settings, then try again. You can also close this window and choose a photo.',
      unavailable: 'The camera is not available in this browser. Open this page in a browser with camera access, or close this window and choose a photo.',
      busy: 'We couldn’t open your camera. Close any other app using it, then try again. You can also close this window and choose a photo.',
      capture: 'We couldn’t take that photo. Please try opening the camera again, or close this window and choose a photo.',
    },
  },
  ms: {
    title: 'Momen kecil, khas untuk anda',
    description: 'Cari cahaya yang sesuai. Foto akan diambil selepas kira detik 3 saat.',
    close: 'Tutup kamera',
    loading: 'Membuka kamera anda…',
    shutter: 'Ambil foto',
    capturing: 'Menyediakan foto anda…',
    cancel: 'Batal',
    cancelCountdown: 'Batalkan kira detik',
    retry: 'Cuba kamera lagi',
    countdown: (seconds: number) => `Foto dalam ${seconds} saat`,
    preview: 'Pratonton kamera langsung',
    errors: {
      permission: 'Akses kamera dimatikan. Benarkan akses kamera dalam tetapan pelayar, kemudian cuba lagi. Anda juga boleh tutup tetingkap ini dan pilih foto.',
      unavailable: 'Kamera tidak tersedia dalam pelayar ini. Buka halaman ini dalam pelayar yang menyokong akses kamera, atau tutup tetingkap ini dan pilih foto.',
      busy: 'Kamera tidak dapat dibuka. Tutup aplikasi lain yang menggunakan kamera, kemudian cuba lagi. Anda juga boleh tutup tetingkap ini dan pilih foto.',
      capture: 'Foto tidak dapat diambil. Cuba buka kamera sekali lagi, atau tutup tetingkap ini dan pilih foto.',
    },
  },
}

function cameraError(error: unknown): CameraError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'permission'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'NotSupportedError') return 'unavailable'
  return 'busy'
}

export function CameraCapture({ onCapture, onClose }: Props) {
  const { locale } = useLocale()
  const t = messages[locale]
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const generationRef = useRef(0)
  const activeRef = useRef(false)
  const closingRef = useRef(false)
  const capturingRef = useRef(false)
  const mirroredRef = useRef(true)
  const [mirrored, setMirrored] = useState(true)
  const [status, setStatus] = useState<CameraStatus>('loading')
  const [error, setError] = useState<CameraError | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)

  useModalFocus(dialogRef, true)

  const clearCountdown = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    capturingRef.current = false
  }, [])

  const stopStream = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((track) => track.stop())
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const invalidate = useCallback(() => {
    generationRef.current += 1
    clearCountdown()
    stopStream()
  }, [clearCountdown, stopStream])

  const isCurrent = useCallback((generation: number) => (
    activeRef.current && !closingRef.current && generationRef.current === generation
  ), [])

  const fail = useCallback((kind: CameraError) => {
    invalidate()
    if (!activeRef.current || closingRef.current) return
    setCountdown(null)
    setError(kind)
    setStatus('error')
  }, [invalidate])

  const startCamera = useCallback(async () => {
    invalidate()
    const generation = generationRef.current
    setCountdown(null)
    setError(null)
    setStatus('loading')

    if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
      fail('unavailable')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      })
      // A permission prompt can resolve after the dialog has already closed.
      if (!isCurrent(generation)) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const facingMode = stream.getVideoTracks()[0]?.getSettings?.().facingMode
      mirroredRef.current = facingMode !== 'environment'
      setMirrored(mirroredRef.current)
      const video = videoRef.current
      if (!video) {
        fail('unavailable')
        return
      }
      video.srcObject = stream
      await video.play()
      if (isCurrent(generation) && video.videoWidth > 0 && video.videoHeight > 0) setStatus('ready')
    } catch (reason) {
      if (isCurrent(generation)) fail(cameraError(reason))
    }
  }, [fail, invalidate, isCurrent])

  const close = useCallback(() => {
    if (!activeRef.current || closingRef.current) return
    closingRef.current = true
    invalidate()
    onClose()
  }, [invalidate, onClose])

  useEffect(() => {
    const video = videoRef.current
    activeRef.current = true
    closingRef.current = false
    // oxlint-disable-next-line react/set-state-in-effect -- This effect owns the external camera session and its loading/error state.
    void startCamera()
    return () => {
      activeRef.current = false
      invalidate()
      if (video) video.srcObject = null
    }
  }, [invalidate, startCamera])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [close])

  const takePhoto = (generation: number) => {
    if (!isCurrent(generation)) return
    setCountdown(null)
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      fail('capture')
      return
    }
    try {
      // Bound the bitmap allocation even when a camera provides a 4K stream.
      const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        fail('capture')
        return
      }
      if (mirroredRef.current) {
        context.translate(canvas.width, 0)
        context.scale(-1, 1)
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      // Release the camera while the captured frame is encoded.
      stopStream()
      canvas.toBlob((blob) => {
        if (!isCurrent(generation)) return
        if (!blob) {
          fail('capture')
          return
        }
        closingRef.current = true
        invalidate()
        onCapture(new File([blob], 'wedding-photo.jpg', { type: 'image/jpeg' }))
      }, 'image/jpeg', 0.92)
    } catch {
      if (isCurrent(generation)) fail('capture')
    }
  }

  const startCountdown = () => {
    if (status !== 'ready' || capturingRef.current || !streamRef.current || closingRef.current) return
    capturingRef.current = true
    const generation = generationRef.current
    let remaining = 3
    setCountdown(remaining)
    setStatus('capturing')
    timerRef.current = window.setInterval(() => {
      if (!isCurrent(generation)) {
        clearCountdown()
        return
      }
      remaining -= 1
      if (remaining > 0) {
        setCountdown(remaining)
      } else {
        if (timerRef.current !== null) window.clearInterval(timerRef.current)
        timerRef.current = null
        takePhoto(generation)
      }
    }, 1000)
  }

  const cancelCountdown = () => {
    clearCountdown()
    setCountdown(null)
    setStatus('ready')
  }

  return (
    <div className="camera-overlay">
      <div ref={dialogRef} className="camera-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <button type="button" className="camera-close" aria-label={t.close} onClick={close} data-modal-autofocus><X aria-hidden="true" /></button>
        <h2 id={titleId} className="camera-heading" data-modal-focus-recovery tabIndex={-1}>{t.title}</h2>
        <p id={descriptionId} className="camera-description">{t.description}</p>
        <div className="camera-viewfinder" aria-busy={status === 'loading'}>
          <video
            ref={videoRef}
            className="camera-video"
            aria-label={t.preview}
            autoPlay
            playsInline
            muted
            style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
            onCanPlay={() => {
              const video = videoRef.current
              if (activeRef.current && !closingRef.current && !capturingRef.current && streamRef.current && video?.srcObject === streamRef.current && video.videoWidth > 0 && video.videoHeight > 0) setStatus('ready')
            }}
            onError={() => {
              if (activeRef.current && !closingRef.current && streamRef.current) fail('busy')
            }}
          />
          {status === 'loading' && <p className="camera-loading" role="status">{t.loading}</p>}
          {error && <p className="camera-error" role="alert">{t.errors[error]}</p>}
          {countdown !== null && <span className="camera-countdown" role="status" aria-label={t.countdown(countdown)}>{countdown}</span>}
          {status === 'capturing' && countdown === null && <p className="camera-loading" role="status">{t.capturing}</p>}
        </div>
        <div className="camera-controls">
          <button type="button" className="button button-secondary" onClick={countdown !== null ? cancelCountdown : close}>{countdown !== null ? t.cancelCountdown : t.cancel}</button>
          {status === 'error'
            ? <button type="button" className="button button-primary" onClick={() => void startCamera()}><RotateCcw aria-hidden="true" />{t.retry}</button>
            : <button type="button" className="button button-primary camera-shutter" disabled={status !== 'ready'} onClick={startCountdown}><Camera aria-hidden="true" />{t.shutter}</button>}
        </div>
      </div>
    </div>
  )
}
