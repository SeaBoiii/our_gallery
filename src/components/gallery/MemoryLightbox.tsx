import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, LoaderCircle, RefreshCw, Share2, X } from 'lucide-react'
import type { GalleryMedia } from '../../../shared/contracts'
import { useLocale } from '../../context/useLocale'
import { useModalFocus } from '../../hooks/useModalFocus'
import { copy } from '../../i18n/copy'
import { GalleryApiError, getMediaDownload } from '../../services/api'

type Props = {
  items: GalleryMedia[]
  index: number
  downloadsAvailable: boolean
  onClose: () => void
  onDownloadsLocked: () => void
  onIndexChange: (index: number) => void
  onRefresh: (id: string) => Promise<void>
}

type MediaStatus = 'loading' | 'ready' | 'error'
type Toast = { key: number; itemId: string; message: string; tone: 'status' | 'error' }

function blocksLightboxArrows(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('video, input, textarea, select, [contenteditable="true"], [role="slider"], [role="textbox"]'))
}

export function MemoryLightbox({ items, index, downloadsAvailable, onClose, onDownloadsLocked, onIndexChange, onRefresh }: Props) {
  const { locale } = useLocale()
  const t = copy[locale].gallery
  const item = items[index]
  const itemCount = items.length
  const canNavigate = itemCount > 1
  const dialogRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const refreshedUrl = useRef<string | null>(null)
  const refreshSequence = useRef(0)
  const toastSequence = useRef(0)
  const mounted = useRef(true)
  const [mediaState, setMediaState] = useState<{ itemId: string; url: string; status: MediaStatus } | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null)
  const [mediaAttempt, setMediaAttempt] = useState(0)

  const previous = useCallback(() => {
    if (itemCount > 1) onIndexChange((index - 1 + itemCount) % itemCount)
  }, [index, itemCount, onIndexChange])
  const next = useCallback(() => {
    if (itemCount > 1) onIndexChange((index + 1) % itemCount)
  }, [index, itemCount, onIndexChange])

  useModalFocus(dialogRef, Boolean(item))
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    refreshSequence.current += 1
    touchStart.current = null
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [item?.id, item?.displayUrl])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast((current) => current?.key === toast.key ? null : current), toast.tone === 'error' ? 6000 : 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!item) return
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (!canNavigate || blocksLightboxArrows(event.target)) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        previous()
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
      }
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [canNavigate, item, next, onClose, previous])

  if (!item) return null

  const eventName = item.event.slug === 'solemnisation' ? t.solemnisation : t.reception
  const eventDate = item.event.slug === 'solemnisation' ? t.dateOne : t.dateTwo
  const memoryOwner = item.guestName?.trim() || eventName
  const position = t.memoryPosition(index + 1, itemCount)
  const dialogLabel = `${t.dialog}: ${t[item.mediaType]} ${t.from} ${memoryOwner}. ${position}`
  const currentMediaStatus = mediaState?.itemId === item.id && mediaState.url === item.displayUrl ? mediaState.status : 'loading'
  const downloadBusy = downloadBusyId === item.id
  const journal = locale === 'ms'
    ? { label: 'Jurnal perkahwinan', keyboard: 'Anak panah untuk melihat · Esc untuk tutup' }
    : { label: 'Wedding journal', keyboard: 'Arrow keys to browse · Esc to close' }
  const guestMessage = item.guestMessage?.trim()
  const guestName = item.guestName?.trim()

  const announce = (message: string, tone: Toast['tone'] = 'status') => {
    if (!mounted.current) return
    setToast({ key: ++toastSequence.current, itemId: item.id, message, tone })
  }

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?memory=${encodeURIComponent(item.id)}`
    const data = { title: t.shareTitle, text: item.guestMessage || t.shareFallback, url }
    if (navigator.share) {
      try {
        await navigator.share(data)
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) announce(t.shareFailed, 'error')
      }
      return
    }
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(url)
      announce(t.copied)
    } catch {
      announce(t.shareFailed, 'error')
    }
  }

  const download = async () => {
    if (downloadBusy) return
    const mediaId = item.id
    setDownloadBusyId(mediaId)
    try {
      const { url } = await getMediaDownload(mediaId)
      if (!mounted.current) return
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.rel = 'noopener'
      anchor.download = ''
      document.body.append(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
      }
      announce(t.downloadStarting)
    } catch (reason) {
      if (!mounted.current) return
      if (reason instanceof GalleryApiError && reason.code === 'DOWNLOADS_NOT_YET_AVAILABLE') {
        onDownloadsLocked()
        announce(t.downloadUnavailable, 'error')
      } else {
        announce(t.downloadFailed, 'error')
      }
    } finally {
      if (mounted.current) setDownloadBusyId((current) => current === mediaId ? null : current)
    }
  }

  const setCurrentMediaStatus = (status: MediaStatus) => {
    if (status === 'ready') refreshSequence.current += 1
    setMediaState({ itemId: item.id, url: item.displayUrl, status })
  }

  const refreshMedia = async (force = false) => {
    const failedUrl = `${item.id}:${item.displayUrl}`
    if (!force && refreshedUrl.current === failedUrl) {
      setCurrentMediaStatus('error')
      return
    }
    const sequence = ++refreshSequence.current
    refreshedUrl.current = failedUrl
    setCurrentMediaStatus('loading')
    try {
      await onRefresh(item.id)
      if (!mounted.current || sequence !== refreshSequence.current) return
      if (force) {
        // Protected Worker URLs remain stable. Remount the element to retry its
        // request without changing that URL or its visibility checks.
        setMediaAttempt((attempt) => attempt + 1)
      } else {
        setCurrentMediaStatus('error')
      }
    } catch {
      if (mounted.current && sequence === refreshSequence.current) setCurrentMediaStatus('error')
    }
  }

  const mediaClassName = `lightbox-media is-${currentMediaStatus}`

  return (
    <div ref={dialogRef} className="lightbox lightbox--journal" role="dialog" aria-modal="true" aria-label={dialogLabel} tabIndex={-1}>
      <div className="lightbox-bar">
        <p className="lightbox-flight"><span>{journal.label}</span>{copy[locale].brand}</p>
        <div className="lightbox-actions">
          {downloadsAvailable ? (
            <button type="button" onClick={() => { void download().catch(() => undefined) }} disabled={downloadBusy} aria-label={t.download} aria-busy={downloadBusy} title={t.download}>
              {downloadBusy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
            </button>
          ) : null}
          <button type="button" onClick={() => void share()} aria-label={t.share} title={t.share}><Share2 aria-hidden="true" /></button>
          <button type="button" className="lightbox-close" onClick={onClose} aria-label={t.close} title={t.close} data-modal-autofocus data-modal-focus-recovery><X aria-hidden="true" /></button>
        </div>
      </div>

      <figure ref={contentRef} className={`lightbox-content${item.mediaType === 'video' ? ' lightbox-content--video' : ''}`} tabIndex={0}>
        <div className="lightbox-stage"
        onTouchStart={item.mediaType === 'photo' && canNavigate ? (event) => {
          const touch = event.touches.length === 1 ? event.touches[0] : null
          touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null
        } : undefined}
        onTouchCancel={() => { touchStart.current = null }}
        onTouchEnd={item.mediaType === 'photo' && canNavigate ? (event) => {
          if (touchStart.current === null) return
          const touch = event.changedTouches[0]
          const delta = (touch?.clientX ?? touchStart.current.x) - touchStart.current.x
          const vertical = (touch?.clientY ?? touchStart.current.y) - touchStart.current.y
          if (Math.abs(delta) > 55 && Math.abs(delta) > Math.abs(vertical) * 1.4) {
            if (delta > 0) previous()
            else next()
          }
          touchStart.current = null
        } : undefined}
      >
        {item.mediaType === 'video' ? (
          <video
            key={`${item.id}:${item.displayUrl}:${mediaAttempt}`}
            className={mediaClassName}
            src={item.displayUrl}
            poster={item.thumbnailUrl}
            controls
            playsInline
            preload="metadata"
            tabIndex={0}
            aria-label={`${t.videoMemory} ${t.from} ${memoryOwner}`}
            onLoadedMetadata={() => setCurrentMediaStatus('ready')}
            onLoadedData={() => setCurrentMediaStatus('ready')}
            onCanPlay={() => setCurrentMediaStatus('ready')}
            onError={() => void refreshMedia()}
          />
        ) : (
          <img
            key={`${item.id}:${item.displayUrl}:${mediaAttempt}`}
            className={mediaClassName}
            src={item.displayUrl}
            alt={item.guestMessage || `${t.guestMemory} ${t.from} ${eventName}`}
            decoding="async"
            onLoad={() => setCurrentMediaStatus('ready')}
            onError={() => void refreshMedia()}
          />
        )}

        {currentMediaStatus !== 'ready' ? (
          <div className={`lightbox-media-status is-${currentMediaStatus}`} role={currentMediaStatus === 'error' ? 'alert' : 'status'} aria-live="polite">
            {currentMediaStatus === 'loading' ? (
              <><LoaderCircle className="spin" aria-hidden="true" /><span>{t.mediaLoading}</span></>
            ) : (
              <><p>{t.mediaFailed}</p><button type="button" onClick={() => void refreshMedia(true)}><RefreshCw aria-hidden="true" />{t.retryMedia}</button></>
            )}
          </div>
        ) : null}
        </div>
        <figcaption className="lightbox-notes">
          {guestMessage ? <blockquote>“{guestMessage}”</blockquote> : null}
          {guestName ? <p className="lightbox-guest"><span>{t.sharedBy}</span>{' '}<strong>{guestName}</strong></p> : null}
          <time className="lightbox-note-reference" dateTime={item.event.eventDate}>{eventDate}</time>
        </figcaption>
      </figure>

      <div className={`lightbox-navigation${canNavigate ? '' : ' is-single'}`}>
        {canNavigate ? <button type="button" className="lightbox-arrow lightbox-arrow--previous" onClick={previous} aria-label={t.previous}><ChevronLeft aria-hidden="true" /></button> : null}
        <p className="lightbox-count" aria-live="polite" aria-atomic="true">{position}</p>
        {canNavigate ? <button type="button" className="lightbox-arrow lightbox-arrow--next" onClick={next} aria-label={t.next}><ChevronRight aria-hidden="true" /></button> : null}
      </div>
      <p className="lightbox-keyboard-hint" aria-hidden="true">{journal.keyboard}</p>

      {toast?.itemId === item.id ? (
        <p key={toast.key} className={`lightbox-toast is-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'} aria-live={toast.tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
          {toast.message}
        </p>
      ) : null}
    </div>
  )
}
