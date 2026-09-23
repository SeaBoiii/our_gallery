import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, ChevronLeft, ImagePlus, Plane, WifiOff, X } from 'lucide-react'
import type { EventSlug, GalleryEvent, PrepareUploadRequest } from '../../../shared/contracts'
import { MAX_FILES_PER_BATCH, UPLOAD_CONCURRENCY, USE_MOCK_DATA } from '../../config'
import { useLocale } from '../../context/useLocale'
import { useModalFocus } from '../../hooks/useModalFocus'
import { copy } from '../../i18n/copy'
import { GalleryApiError, getEvents, prepareUploads } from '../../services/api'
import { UploadTransferError, uploadQueueItem } from '../../services/upload'
import type { UploadQueueItem } from '../../types/upload'
import { createImageDerivatives, fingerprintFile, formatBytes, getUploadMimeType, validateFile } from '../../utils/files'
import { getSingaporeEventDefault } from '../../utils/date'
import { EventSelector } from './EventSelector'
import { TurnstileWidget } from './TurnstileWidget'
import { UploadQueue } from './UploadQueue'

type Props = {
  open: boolean
  initialFiles: File[]
  onClose: () => void
  onViewGallery: () => void
}

export function UploadExperience({ open, initialFiles, onClose, onViewGallery }: Props) {
  const { locale } = useLocale()
  const t = copy[locale].upload
  const [step, setStep] = useState(0)
  const [eventSlug, setEventSlug] = useState<EventSlug | null>(() => getSingaporeEventDefault())
  const [availableEvents, setAvailableEvents] = useState<GalleryEvent[] | null>(null)
  const [guestName, setGuestName] = useState('')
  const [guestMessage, setGuestMessage] = useState('')
  const [queue, setQueue] = useState<UploadQueueItem[]>([])
  const queueRef = useRef<UploadQueueItem[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [turnstileToken, setTurnstileToken] = useState('')
  const [verificationVersion, setVerificationVersion] = useState(0)
  const initialFilesConsumed = useRef<File[] | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const chooserRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(crypto.randomUUID())
  const operationRef = useRef(false)
  const [operationActive, setOperationActive] = useState(false)
  const activelyUploading = operationActive || queue.some((item) => ['preparing','uploading','completing'].includes(item.state))
  const hasUnfinishedSelection = queue.some((item) => item.state !== 'complete')

  const reset = useCallback(() => {
    queueRef.current.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl) })
    setQueue([])
    setGuestName('')
    setGuestMessage('')
    setEventSlug(getSingaporeEventDefault())
    setTurnstileToken(''); setVerificationVersion((value) => value + 1)
    requestIdRef.current = crypto.randomUUID()
    setErrors([])
    setStep(0)
  }, [])
  const handleClose = useCallback(() => {
    if (operationRef.current) return
    if (step === 3) reset()
    onClose()
  }, [onClose, reset, step])
  const handleViewGallery = useCallback(() => {
    reset()
    onViewGallery()
  }, [onViewGallery, reset])

  useModalFocus(dialogRef, open)

  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => () => queueRef.current.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl) }), [])

  const updateItem = useCallback((clientId: string, patch: Partial<UploadQueueItem>) => {
    setQueue((items) => items.map((item) => item.clientId === clientId ? { ...item, ...patch } : item))
  }, [])
  const onTurnstileError = useCallback((message: string) => setErrors([message]), [])

  const addFiles = useCallback((incoming: File[]) => {
    requestIdRef.current = crypto.randomUUID()
    setErrors([])
    setQueue((current) => {
      const available = Math.max(0, MAX_FILES_PER_BATCH - current.length)
      const accepted: UploadQueueItem[] = []
      const problems: string[] = []
      if (incoming.length > available) problems.push(t.batchLimit)
      for (const file of incoming.slice(0, available)) {
        const duplicate = current.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified) || accepted.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)
        if (duplicate) { problems.push(`${file.name}: ${t.duplicateFile}`); continue }
        const validation = validateFile(file)
        if (!validation.valid) {
          const message = validation.reason === 'image-too-large' ? t.photoTooLarge : validation.reason === 'video-too-large' ? t.videoTooLarge : t.unsupportedFile
          problems.push(`${file.name}: ${message}`)
          continue
        }
        const heic = /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type)
        accepted.push({
          clientId: crypto.randomUUID(),
          file,
          mediaType: validation.mediaType,
          previewUrl: heic ? '' : URL.createObjectURL(file),
          derivatives: [],
          derivativeStatus: validation.mediaType === 'video' ? 'not_required' : 'pending',
          state: 'queued',
          progress: 0,
        })
      }
      if (problems.length) window.setTimeout(() => setErrors(problems), 0)
      return [...current, ...accepted]
    })
  }, [t.batchLimit, t.duplicateFile, t.photoTooLarge, t.unsupportedFile, t.videoTooLarge])

  useEffect(() => {
    if (!open || !initialFiles.length || initialFilesConsumed.current === initialFiles) return
    const timer = window.setTimeout(() => { initialFilesConsumed.current = initialFiles; addFiles(initialFiles) }, 0)
    return () => window.clearTimeout(timer)
  }, [open, initialFiles, addFiles])

  useEffect(() => {
    if (!open) return
    let active = true
    void getEvents().then((events) => {
      if (!active) return
      setAvailableEvents(events)
      setEventSlug((current) => events.some((event) => event.slug === current && event.uploadEnabled) ? current : events.find((event) => event.uploadEnabled)?.slug ?? null)
      if (!events.some((event) => event.uploadEnabled)) setErrors([t.checkInClosed])
    }).catch(() => {
      // The prepare endpoint remains authoritative if availability cannot load.
      if (active) setAvailableEvents(null)
    })
    return () => { active = false }
  }, [open, t.checkInClosed])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  useEffect(() => {
    if (!open || !hasUnfinishedSelection) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [hasUnfinishedSelection, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !activelyUploading) handleClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKeyDown) }
  }, [activelyUploading, handleClose, open])

  const totalBytes = useMemo(() => queue.reduce((sum, item) => sum + item.file.size, 0), [queue])
  const overallProgress = queue.length ? Math.round(queue.reduce((sum, item) => sum + item.progress, 0) / queue.length) : 0
  const completed = queue.filter((item) => item.state === 'complete').length
  const failed = queue.filter((item) => item.state === 'failed').length

  const localizedErrorMessage = (reason: unknown) => {
    if (reason instanceof GalleryApiError) {
      if (['UPLOADS_CLOSED', 'EVENT_UPLOADS_CLOSED'].includes(reason.code)) return t.checkInClosed
      if (['TURNSTILE_REQUIRED', 'TURNSTILE_FAILED', 'TURNSTILE_UNAVAILABLE'].includes(reason.code)) return t.verificationFailed
      if (['UPLOAD_AUTHORIZATION_EXPIRED', 'REQUEST_ID_CONFLICT', 'INVALID_UPLOAD_STATE'].includes(reason.code)) return t.checkInExpired
      if (reason.code === 'REQUEST_IN_PROGRESS') return t.checkInPreparing
      if (reason.code === 'DUPLICATE_FILE') return `${typeof reason.details?.filename === 'string' ? `${reason.details.filename}: ` : ''}${t.alreadyUploaded}`
      if (reason.code === 'RATE_LIMITED') return t.rateLimited
      if (reason.code === 'STORAGE_LIMIT') return t.storageFull
      if (reason.code === 'ORIGINAL_MISSING') return t.finishingDelayed
      if (reason.code === 'UNSUPPORTED_FILE') return t.unsupportedFile
      if (reason.code === 'FILE_TOO_LARGE') return t.uploadFailed
      if (reason.code === 'NETWORK_ERROR' || reason.code.startsWith('HTTP_')) return t.connectionLost
      return locale === 'en' ? reason.message : t.uploadFailed
    }
    return reason instanceof Error ? t.preparationFailed : t.connectionLost
  }

  const uploadErrorMessage = (reason: unknown) => {
    if (reason instanceof UploadTransferError) {
      if (reason.code === 'NETWORK_INTERRUPTED') return t.networkInterrupted
      if (reason.code === 'UPLOAD_STALLED') return t.uploadStalled
      if (reason.code === 'UPLOAD_CANCELLED') return t.uploadCancelled
      if (reason.code === 'UPLOAD_REJECTED') return t.uploadRejected
    }
    return localizedErrorMessage(reason)
  }

  const restartPreparation = (message: string) => {
    requestIdRef.current = crypto.randomUUID()
    setTurnstileToken(''); setVerificationVersion((value) => value + 1)
    setErrors([message])
    setQueue((items) => items.map((item) => item.state === 'complete' ? item : { ...item, prepared: undefined, state: 'queued', progress: 0, error: undefined }))
    setStep(1)
  }

  const remove = (clientId: string) => setQueue((items) => {
    requestIdRef.current = crypto.randomUUID()
    const target = items.find((item) => item.clientId === clientId)
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
    return items.filter((item) => item.clientId !== clientId)
  })

  const runConcurrent = async (items: UploadQueueItem[], refreshBeforeUpload = false) => {
    let cursor = 0
    const failedIds: string[] = []
    let freshPreparationMessage = ''
    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor++
        const item = items[index]
        updateItem(item.clientId, { state: 'uploading', progress: 0, error: undefined })
        try {
          await uploadQueueItem(item, (progress) => updateItem(item.clientId, { state: progress >= 100 ? 'completing' : 'uploading', progress }), { refreshBeforeUpload })
          updateItem(item.clientId, { state: 'complete', progress: 100 })
        } catch (reason) {
          failedIds.push(item.clientId)
          if (reason instanceof GalleryApiError && ['UPLOAD_AUTHORIZATION_EXPIRED','INVALID_UPLOAD_STATE'].includes(reason.code)) freshPreparationMessage ||= localizedErrorMessage(reason)
          else updateItem(item.clientId, { state: 'failed', error: uploadErrorMessage(reason) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, items.length) }, () => worker()))
    if (freshPreparationMessage) restartPreparation(freshPreparationMessage)
    return { failedIds, restarted: Boolean(freshPreparationMessage) }
  }

  const startUpload = async () => {
    if (operationRef.current) return
    if (!eventSlug || !queue.some((item) => item.state !== 'complete') || (!turnstileToken && !USE_MOCK_DATA)) return
    operationRef.current = true
    setOperationActive(true)
    setErrors([])
    setStep(2)
    const preparedItems: UploadQueueItem[] = []
    let preparedByApi = false
    try {
      for (const item of queue.filter((item) => item.state !== 'complete')) {
        updateItem(item.clientId, { state: 'preparing', error: undefined })
        let derivatives = item.derivatives
        if (item.mediaType === 'photo' && !derivatives.length) {
          try { derivatives = await createImageDerivatives(item.file) } catch { derivatives = [] }
        }
        const fingerprint = item.fingerprint || await fingerprintFile(item.file)
        preparedItems.push({ ...item, derivatives, fingerprint, derivativeStatus: derivatives.length ? 'pending' : item.mediaType === 'video' ? 'not_required' : 'unavailable', state: 'preparing' })
        updateItem(item.clientId, { derivatives, fingerprint, derivativeStatus: derivatives.length ? 'pending' : item.mediaType === 'video' ? 'not_required' : 'unavailable' })
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }

      const payload: PrepareUploadRequest = {
        requestId: requestIdRef.current,
        eventSlug,
        guestName: guestName.trim() || undefined,
        guestMessage: guestMessage.trim() || undefined,
        turnstileToken: turnstileToken || 'development-bypass',
        files: preparedItems.map((item) => ({
          clientId: item.clientId,
          filename: item.file.name,
          mimeType: getUploadMimeType(item.file),
          size: item.file.size,
          mediaType: item.mediaType,
          fingerprint: item.fingerprint!,
          variants: item.derivatives.map((derivative) => derivative.intent),
        })),
      }
      const response = await prepareUploads(payload)
      preparedByApi = true
      const ready = preparedItems.map((item) => ({ ...item, prepared: response.uploads.find((upload) => upload.clientId === item.clientId)! }))
      setQueue((items) => [...items.filter((item) => item.state === 'complete'), ...ready])
      const { failedIds, restarted } = await runConcurrent(ready)
      if (!restarted) setStep(failedIds.length ? 2 : 3)
    } catch (reason) {
      const message = localizedErrorMessage(reason)
      setErrors([message])
      if (!preparedByApi) {
        if (reason instanceof GalleryApiError && ['UPLOAD_AUTHORIZATION_EXPIRED','REQUEST_ID_CONFLICT'].includes(reason.code)) requestIdRef.current = crypto.randomUUID()
        setTurnstileToken(''); setVerificationVersion((value) => value + 1)
        setQueue((items) => items.map((item) => item.state === 'complete' ? item : { ...item, state: 'queued', progress: 0, error: undefined }))
        setStep(1)
      } else {
        setQueue((items) => items.map((item) => item.state === 'complete' ? item : { ...item, state: 'failed', error: message }))
      }
    } finally { operationRef.current = false; setOperationActive(false) }
  }

  const retryOne = async (clientId: string) => {
    if (operationRef.current) return
    const item = queue.find((candidate) => candidate.clientId === clientId)
    if (!item || item.state !== 'failed') return
    operationRef.current = true
    setOperationActive(true)
    updateItem(clientId, { state: 'uploading', error: undefined })
    try {
      await uploadQueueItem(item, (progress) => updateItem(clientId, { state: progress >= 100 ? 'completing' : 'uploading', progress }), { refreshBeforeUpload: true })
      setQueue((items) => {
        const next = items.map((candidate) => candidate.clientId === clientId ? { ...candidate, state: 'complete' as const, progress: 100, error: undefined } : candidate)
        if (next.every((candidate) => candidate.state === 'complete')) window.setTimeout(() => setStep(3), 0)
        return next
      })
    } catch (reason) {
      if (reason instanceof GalleryApiError && ['UPLOAD_AUTHORIZATION_EXPIRED','INVALID_UPLOAD_STATE'].includes(reason.code)) {
        restartPreparation(localizedErrorMessage(reason))
        return
      }
      updateItem(clientId, { state: 'failed', error: uploadErrorMessage(reason) })
    } finally { operationRef.current = false; setOperationActive(false) }
  }

  const retryFailed = async () => {
    if (operationRef.current) return
    const remaining = queue.filter((item) => item.state === 'failed')
    if (!remaining.length) return
    operationRef.current = true
    setOperationActive(true)
    try {
      const { failedIds, restarted } = await runConcurrent(remaining, true)
      if (!restarted && !failedIds.length) setStep(3)
    } finally { operationRef.current = false; setOperationActive(false) }
  }

  if (!open) return null
  const hasFilesToSend = queue.some((item) => item.state !== 'complete')
  const canContinue = step === 0 ? hasFilesToSend : step === 1 ? Boolean(eventSlug) && hasFilesToSend && online && Boolean(turnstileToken || USE_MOCK_DATA) : false
  const changeDetails = (update: () => void) => { requestIdRef.current = crypto.randomUUID(); update() }

  return (
    <div className="upload-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !activelyUploading) handleClose() }}>
      <div ref={dialogRef} className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title" tabIndex={-1}>
        <header className="upload-header">
          <div><p>{t.checkIn}</p><span>ALEEM & NURULAIN · 21—22.08.2027</span></div>
          <button type="button" onClick={handleClose} disabled={activelyUploading} aria-label={t.close} data-modal-autofocus><X aria-hidden="true" /></button>
        </header>
        <div className="upload-progress-steps" aria-label={step < 2 ? `${t.step} ${step + 1} ${t.of} 2` : t.steps[step]}>
          {t.steps.map((label, index) => <span key={label} className={index <= step ? 'is-active' : ''}><i>{index < step ? <Check aria-hidden="true" size={10} /> : index + 1}</i><b>{label}</b></span>)}
        </div>
        <div className="upload-body">
          {!online ? <div className="offline-banner" role="status"><WifiOff aria-hidden="true" size={16} />{t.offline}</div> : null}
          {step === 0 ? (
            <section><p className="eyebrow">{t.mediaEyebrow}</p><h2 id="upload-title" data-modal-focus-recovery tabIndex={-1}>{t.addMemories}</h2><p className="step-intro">{t.addMemoriesBody}</p>
              <div className="media-picker-actions">
                <button type="button" onClick={() => cameraRef.current?.click()}><Camera aria-hidden="true" /><span><strong>{copy[locale].takePhoto}</strong><small>{t.useCamera}</small></span></button>
                <button type="button" onClick={() => chooserRef.current?.click()}><ImagePlus aria-hidden="true" /><span><strong>{copy[locale].chooseMedia}</strong><small>{t.selectMultiple}</small></span></button>
              </div>
              <p className="file-limits">{locale === 'en' ? 'Photos up to 25 MB · Videos up to 250 MB' : 'Foto sehingga 25 MB · Video sehingga 250 MB'}</p>
              {queue.length ? <div className="queue-summary"><span><strong>{queue.length}</strong> {t.selected}</span><span>{formatBytes(totalBytes)}</span></div> : null}
              <UploadQueue items={queue} canRemove onRemove={remove} />
            </section>
          ) : null}
          {step === 1 ? (
            <section><p className="eyebrow">{t.passengerEyebrow}</p><h2 id="upload-title" data-modal-focus-recovery tabIndex={-1}>{t.sharing}</h2><p className="step-intro">{t.sharingBody}</p>
              <EventSelector value={eventSlug} onChange={(value) => changeDetails(() => setEventSlug(value))} events={availableEvents} />
              <div className="guest-fields">
                <label><span>{t.name}<small>{t.optional}</small></span><input value={guestName} maxLength={80} autoComplete="name" placeholder={t.namePlaceholder} onChange={(event) => changeDetails(() => setGuestName(event.target.value))} /></label>
                <label><span>{t.message}<small>{t.optional}</small></span><textarea value={guestMessage} maxLength={280} rows={3} placeholder={t.messagePlaceholder} onChange={(event) => changeDetails(() => setGuestMessage(event.target.value))} /><em>{guestMessage.length}/280</em></label>
              </div>
              <p className="moderation-note">{locale === 'en' ? 'Your memories will appear in the gallery after approval.' : 'Kenangan anda akan dipaparkan dalam galeri selepas diluluskan.'}</p>
              <div className="verification"><p>{t.verification}</p><TurnstileWidget resetKey={verificationVersion} onToken={setTurnstileToken} onError={onTurnstileError} />{!turnstileToken && !USE_MOCK_DATA ? <button className="back-button" type="button" onClick={() => { setErrors([]); setVerificationVersion((value) => value + 1) }}>{copy[locale].tryAgain}</button> : null}</div>
            </section>
          ) : null}
          {step === 2 ? (
            <section><p className="eyebrow">{t.departureEyebrow}</p><h2 id="upload-title" data-modal-focus-recovery tabIndex={-1}>{t.checkingIn}</h2><p className="step-intro">{t.checkingInBody}</p>
              <div className="overall-progress" role="progressbar" aria-label={t.overallProgress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallProgress}><span style={{ width: `${overallProgress}%` }} /><b>{overallProgress}%</b><Plane aria-hidden="true" style={{ left: `calc(${overallProgress}% - 9px)` }} /></div>
              <p className="upload-count">{completed} / {queue.length} {t.safelyCheckedIn}{failed ? ` · ${failed} ${t.needAttention}` : ''}</p>
              <UploadQueue items={queue} canRemove={false} onRemove={remove} onRetry={activelyUploading ? undefined : (id) => void retryOne(id)} />
              {failed && !activelyUploading ? <button type="button" className="button button-secondary retry-all" onClick={() => void retryFailed()}>{t.retry}</button> : null}
            </section>
          ) : null}
          {step === 3 ? (
            <section className="upload-success"><div className="success-route"><Plane aria-hidden="true" /><span /><i /></div><p className="eyebrow">{t.completeEyebrow}</p><h2 id="upload-title" data-modal-focus-recovery tabIndex={-1}>{t.success}</h2><p>{t.successBody}</p><div className="success-ticket"><span>{t.memoriesLabel}</span><strong>{completed}</strong><span>{t.statusLabel}</span><strong>{failed ? t.partial : t.safe}</strong></div><div className="success-actions"><button className="button button-primary" type="button" onClick={handleViewGallery}>{t.viewGallery}</button><button className="button button-secondary" type="button" onClick={reset}>{t.addMore}</button></div></section>
          ) : null}
          {errors.length ? <div className="upload-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
        </div>
        {step < 2 ? <footer className="upload-footer"><button type="button" className="back-button" onClick={() => step === 0 ? handleClose() : setStep(0)}><ChevronLeft aria-hidden="true" />{t.back}</button><button type="button" className="button button-primary" disabled={!canContinue} onClick={() => step === 1 ? void startUpload() : setStep(1)}>{step === 1 ? t.startUpload : t.continue}</button></footer> : null}
        <input ref={cameraRef} className="visually-hidden" type="file" aria-label={t.useCamera} accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.currentTarget.value = '' }} />
        <input ref={chooserRef} className="visually-hidden" type="file" aria-label={t.selectMultiple} accept="image/*,video/*" multiple tabIndex={-1} aria-hidden="true" onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.currentTarget.value = '' }} />
      </div>
    </div>
  )
}
