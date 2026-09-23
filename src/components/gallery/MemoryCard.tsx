import { useState } from 'react'
import { ArrowUpRight, ImageOff, Play } from 'lucide-react'
import type { GalleryMedia } from '../../../shared/contracts'
import { USE_MOCK_DATA } from '../../config'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'

function absoluteUrl(value: string) {
  try { return new URL(value, window.location.href).href } catch { return value }
}

export function MemoryCard({ memory, onOpen, number = 1, view = 'journal' }: { memory: GalleryMedia; onOpen: () => void; number?: number; view?: 'journal' | 'grid' }) {
  const { locale } = useLocale()
  const t = copy[locale].gallery
  const width = memory.width && memory.width > 0 ? memory.width : 0
  const height = memory.height && memory.height > 0 ? memory.height : 0
  const ratio = width && height ? `${width} / ${height}` : '4 / 3'
  const portrait = width && height ? width / height < 0.9 : false
  const eventName = memory.event.slug === 'solemnisation' ? t.solemnisation : t.reception
  const [failedUrls, setFailedUrls] = useState<string[]>([])
  const thumbnail = memory.thumbnailUrl && !failedUrls.includes(absoluteUrl(memory.thumbnailUrl)) ? memory.thumbnailUrl : ''
  const display = memory.mediaType === 'photo' && memory.displayUrl && !failedUrls.includes(absoluteUrl(memory.displayUrl)) ? memory.displayUrl : ''
  const imageSource = thumbnail || display
  const longestEdge = Math.max(width, height)
  const thumbnailWidth = longestEdge ? Math.max(1, Math.round(width * Math.min(1, 480 / longestEdge))) : 0
  const displayWidth = longestEdge ? Math.max(1, Math.round(width * Math.min(1, 1800 / longestEdge))) : 0
  const responsiveSource = thumbnail && display && thumbnail !== display && displayWidth > thumbnailWidth
    ? `${thumbnail} ${thumbnailWidth}w, ${display} ${displayWidth}w`
    : undefined
  const duration = memory.durationSeconds && memory.durationSeconds > 0
    ? `${Math.floor(memory.durationSeconds / 60)}:${String(Math.floor(memory.durationSeconds % 60)).padStart(2, '0')}` : ''
  const date = memory.event.slug === 'solemnisation' ? t.dayOne : t.dayTwo
  const owner = memory.guestName || t.guestMemory
  return (
    <button className={`memory-card${portrait ? ' memory-card--portrait' : ''}${memory.mediaType === 'video' ? ' memory-card--video' : ''}`} type="button" onClick={onOpen} aria-label={`${t.open} ${t[memory.mediaType]} ${t.from} ${eventName}: ${owner}`}>
      <span className="memory-mount">
      <span className="memory-frame" style={{ aspectRatio: ratio }}>
        {imageSource ? <img
          src={imageSource}
          srcSet={responsiveSource}
          sizes={responsiveSource ? view === 'grid' ? '(max-width: 639px) 44vw, (max-width: 959px) 29vw, 300px' : '(max-width: 639px) 88vw, (max-width: 959px) 44vw, 740px' : undefined}
          width={width || undefined}
          height={height || undefined}
          alt={memory.guestMessage || `${t.guestMemory} ${t.from} ${eventName}`}
          loading="lazy"
          decoding="async"
          onError={(event) => {
            const failed = absoluteUrl(event.currentTarget.currentSrc || event.currentTarget.src)
            setFailedUrls((current) => current.includes(failed) ? current : [...current, failed])
          }}
        /> : memory.mediaType === 'video' ? (
          <span className="media-placeholder media-placeholder--video"><Play aria-hidden="true" /><small>{t.videoMemory}</small><span>{locale === 'en' ? 'Press play, relive the moment.' : 'Mainkan semula detik indah.'}</span></span>
        ) : (
          <span className="media-placeholder"><ImageOff aria-hidden="true" /><small>{t.previewUnavailable}</small></span>
        )}
        {memory.mediaType === 'video' ? <span className="video-badge"><Play aria-hidden="true" size={11} fill="currentColor" />{duration || t.videos}</span> : null}
        {USE_MOCK_DATA ? <span className="sample-badge">{t.preview}</span> : null}
      </span>
      </span>
      <span className="memory-caption">
        <span className="memory-number" aria-hidden="true">{String(number).padStart(2, '0')}</span>
        <span className="memory-caption-copy"><strong>{memory.guestMessage || owner}</strong><span className="memory-caption-meta">{date}{memory.guestName && memory.guestMessage ? <><i aria-hidden="true"> · </i>{memory.guestName}</> : null}</span></span>
        <ArrowUpRight className="memory-open-mark" size={17} aria-hidden="true" />
      </span>
    </button>
  )
}
