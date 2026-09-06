import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Heart, LoaderCircle, Share2, X } from 'lucide-react'
import type { GalleryMedia } from '../../../shared/contracts'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'
import { useModalFocus } from '../../hooks/useModalFocus'
import { getMediaDownload } from '../../services/api'

type Props = {
  items: GalleryMedia[]
  index: number
  onClose: () => void
  onIndexChange: (index: number) => void
  onRefresh: (id: string) => Promise<void>
  favourite: boolean
  onToggleFavourite: () => void
  canonicalPath: string
}

export function MemoryLightbox({ items, index, onClose, onIndexChange, onRefresh, favourite, onToggleFavourite, canonicalPath }: Props) {
  const { locale } = useLocale()
  const t = copy[locale].gallery
  const item = items[index]
  const dialogRef = useRef<HTMLDivElement>(null)
  const touchStart = useRef<number | null>(null)
  const refreshedUrl = useRef<string | null>(null)
  const [shareStatus, setShareStatus] = useState<{ id: string; message: string } | null>(null)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const previous = () => onIndexChange((index - 1 + items.length) % items.length)
  const next = () => onIndexChange((index + 1) % items.length)
  useModalFocus(dialogRef, true)

  useEffect(() => {
    refreshedUrl.current = null
  }, [item?.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') previous()
      if (event.key === 'ArrowRight') next()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKeyDown) }
  })

  if (!item) return null
  const eventName = item.event.slug === 'solemnisation' ? t.solemnisation : t.reception
  const eventDate = item.event.slug === 'solemnisation' ? t.dateOne : t.dateTwo
  const mediaDescription = item.altText || item.guestMessage || `${t.guestMemory} ${t.from} ${eventName}`
  const share = async () => {
    const url = `${window.location.origin}${canonicalPath}?memory=${encodeURIComponent(item.id)}`
    const data = { title: t.shareTitle, text: item.guestMessage || t.shareFallback, url }
    if (navigator.share) {
      await navigator.share(data).catch(() => undefined)
      return
    }
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setShareStatus({ id: item.id, message: t.copied })
    } catch {
      setShareStatus({ id: item.id, message: t.shareFailed })
    }
  }

  const download = async () => {
    if (downloadBusy) return
    setDownloadBusy(true)
    setDownloadError(null)
    try {
      const { url } = await getMediaDownload(item.id)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.rel = 'noopener'
      anchor.download = ''
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
    } catch {
      setDownloadError(t.downloadFailed)
    } finally {
      setDownloadBusy(false)
    }
  }

  const refreshMedia = async () => {
    if (refreshedUrl.current === item.displayUrl) return
    refreshedUrl.current = item.displayUrl
    await onRefresh(item.id).catch(() => undefined)
  }

  return (
    <div ref={dialogRef} className="lightbox" role="dialog" aria-modal="true" aria-label={t.dialog} tabIndex={-1}>
      <div className="lightbox-bar">
        <p><span>{eventDate}</span>{eventName}</p>
        <div>
          <button type="button" onClick={onToggleFavourite} aria-pressed={favourite} aria-label={favourite ? t.removeFavourite : t.addFavourite}><Heart aria-hidden="true" fill={favourite ? 'currentColor' : 'none'} /></button>
          <button type="button" onClick={() => void download()} disabled={downloadBusy} aria-label={t.download}>{downloadBusy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}</button>
          <button type="button" onClick={share} aria-label={t.share}><Share2 aria-hidden="true" /></button>
          <button type="button" onClick={onClose} aria-label={t.close} data-modal-autofocus><X aria-hidden="true" /></button>
        </div>
      </div>
      <button type="button" className="lightbox-arrow lightbox-arrow--previous" onClick={previous} aria-label={t.previous}><ChevronLeft aria-hidden="true" /></button>
      <figure
        className={`lightbox-content${item.mediaType === 'video' ? ' lightbox-content--video' : ''}`}
        onTouchStart={item.mediaType === 'photo' ? (event) => { touchStart.current = event.touches[0]?.clientX ?? null } : undefined}
        onTouchEnd={item.mediaType === 'photo' ? (event) => {
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
          <video src={item.displayUrl} poster={item.thumbnailUrl} controls playsInline preload="metadata" aria-label={mediaDescription} onError={() => void refreshMedia()} />
        ) : (
          <img src={item.displayUrl} alt={mediaDescription} onError={() => void refreshMedia()} />
        )}
        {(item.guestName || item.guestMessage) ? (
          <figcaption>
            {item.guestMessage ? <blockquote>“{item.guestMessage}”</blockquote> : null}
            {item.guestName ? <p>{t.sharedBy} {item.guestName}</p> : null}
          </figcaption>
        ) : null}
      </figure>
      <button type="button" className="lightbox-arrow lightbox-arrow--next" onClick={next} aria-label={t.next}><ChevronRight aria-hidden="true" /></button>
      <p className="lightbox-count" aria-live="polite">{index + 1} / {items.length}</p>
      <p className="visually-hidden" role="status" aria-live="polite">{shareStatus?.id === item.id ? shareStatus.message : ''}</p>
      {downloadError ? <p className="lightbox-error" role="alert">{downloadError}</p> : null}
    </div>
  )
}
