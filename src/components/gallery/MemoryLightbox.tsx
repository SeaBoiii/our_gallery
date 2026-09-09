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
  const touchStart = useRef<number | null>(null)
  const refreshedUrl = useRef<string | null>(null)
  const toastSequence = useRef(0)
  const [mediaState, setMediaState] = useState<{ itemId: string; url: string; status: MediaStatus } | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null)

  const previous = useCallback(() => {
    if (itemCount > 1) onIndexChange((index - 1 + itemCount) % itemCount)
  }, [index, itemCount, onIndexChange])
  const next = useCallback(() => {
    if (itemCount > 1) onIndexChange((index + 1) % itemCount)
  }, [index, itemCount, onIndexChange])

  useModalFocus(dialogRef, Boolean(item))

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

  const announce = (message: string, tone: Toast['tone'] = 'status') => {
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
      if (reason instanceof GalleryApiError && reason.code === 'DOWNLOADS_NOT_YET_AVAILABLE') {
        onDownloadsLocked()
        announce(t.downloadUnavailable, 'error')
      } else {
        announce(t.downloadFailed, 'error')
      }
    } finally {
      setDownloadBusyId((current) => current === mediaId ? null : current)
    }
  }

  const setCurrentMediaStatus = (status: MediaStatus) => {
    setMediaState({ itemId: item.id, url: item.displayUrl, status })
  }

  const refreshMedia = async (force = false) => {
    const failedUrl = `${item.id}:${item.displayUrl}`
    if (!force && refreshedUrl.current === failedUrl) {
      setCurrentMediaStatus('error')
      return
    }
    refreshedUrl.current = failedUrl
    setCurrentMediaStatus('loading')
    try {
      await onRefresh(item.id)
    } catch {
      // The retry panel below is the user-facing recovery path.
    } finally {
      // A new URL resets this state in the effect above. If the URL did not change,
      // leave an actionable retry instead of an endless loading indicator.
      setCurrentMediaStatus('error')
    }
  }

  const mediaClassName = `lightbox-media is-${currentMediaStatus}`
  const hasCaption = Boolean(item.guestName || item.guestMessage)

  return (
    <div ref={dialogRef} className="lightbox" role="dialog" aria-modal="true" aria-label={dialogLabel} tabIndex={-1}>
      <div className="lightbox-bar">
        <p className="lightbox-flight"><span>{eventDate}</span>{eventName}</p>
        <div className="lightbox-actions">
          {downloadsAvailable ? (
            <button type="button" onClick={() => { void download().catch(() => undefined) }} disabled={downloadBusy} aria-label={t.download}>
              {downloadBusy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
            </button>
          ) : null}
          <button type="button" onClick={() => void share()} aria-label={t.share}><Share2 aria-hidden="true" /></button>
          <button type="button" onClick={onClose} aria-label={t.close} data-modal-autofocus data-modal-focus-recovery><X aria-hidden="true" /></button>
        </div>
      </div>

      <figure
        className={`lightbox-content${item.mediaType === 'video' ? ' lightbox-content--video' : ''}${hasCaption ? ' has-caption' : ''}`}
        onTouchStart={item.mediaType === 'photo' && canNavigate ? (event) => { touchStart.current = event.touches[0]?.clientX ?? null } : undefined}
        onTouchEnd={item.mediaType === 'photo' && canNavigate ? (event) => {
          if (touchStart.current === null) return
          const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current
          if (Math.abs(delta) > 55) {
            if (delta > 0) previous()
            else next()
          }
          touchStart.current = null
        } : undefined}
      >
        {item.mediaType === 'video' ? (
          <video
            key={item.displayUrl}
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
            key={item.displayUrl}
            className={mediaClassName}
            src={item.displayUrl}
            alt={item.guestMessage || `${t.guestMemory} ${t.from} ${eventName}`}
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

        {hasCaption ? (
          <figcaption>
            {item.guestMessage ? <blockquote>“{item.guestMessage}”</blockquote> : null}
            {item.guestName ? <p>{t.sharedBy} {item.guestName}</p> : null}
          </figcaption>
        ) : null}
      </figure>

      <div className={`lightbox-navigation${canNavigate ? '' : ' is-single'}`}>
        {canNavigate ? <button type="button" className="lightbox-arrow lightbox-arrow--previous" onClick={previous} aria-label={t.previous}><ChevronLeft aria-hidden="true" /></button> : null}
        <p className="lightbox-count" aria-live="polite" aria-atomic="true">{position}</p>
        {canNavigate ? <button type="button" className="lightbox-arrow lightbox-arrow--next" onClick={next} aria-label={t.next}><ChevronRight aria-hidden="true" /></button> : null}
      </div>

      {toast?.itemId === item.id ? (
        <p key={toast.key} className={`lightbox-toast is-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'} aria-live={toast.tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
          {toast.message}
        </p>
      ) : null}
    </div>
  )
}
