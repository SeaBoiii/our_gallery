import { useState } from 'react'
import { Film, ImageOff, Play } from 'lucide-react'
import type { GalleryMedia } from '../../../shared/contracts'
import { USE_MOCK_DATA } from '../../config'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'

export function MemoryCard({ memory, onOpen }: { memory: GalleryMedia; onOpen: () => void }) {
  const { locale } = useLocale()
  const t = copy[locale].gallery
  const ratio = memory.width && memory.height ? `${memory.width} / ${memory.height}` : '4 / 5'
  const eventName = memory.event.slug === 'solemnisation' ? t.solemnisation : t.reception
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null)
  const thumbnailAvailable = Boolean(memory.thumbnailUrl) && failedThumbnail !== memory.thumbnailUrl
  return (
    <button className="memory-card" type="button" onClick={onOpen} aria-label={`${t.open} ${t[memory.mediaType]} ${t.from} ${eventName}: ${memory.guestName || t.guestMemory}`}>
      <span className="memory-frame" style={{ aspectRatio: ratio }}>
        {thumbnailAvailable ? <img
          src={memory.thumbnailUrl}
          alt={memory.guestMessage || `${t.guestMemory} ${t.from} ${eventName}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailedThumbnail(memory.thumbnailUrl)}
        /> : memory.mediaType === 'video' ? (
          <span className="media-placeholder"><Film aria-hidden="true" /><small>{t.videoMemory}</small></span>
        ) : (
          <span className="media-placeholder"><ImageOff aria-hidden="true" /><small>{t.previewUnavailable}</small></span>
        )}
        {memory.mediaType === 'video' ? <span className="video-badge"><Play aria-hidden="true" size={14} fill="currentColor" /> {t.videos}</span> : null}
        {USE_MOCK_DATA ? <span className="sample-badge">{t.preview}</span> : null}
      </span>
      <span className="memory-caption">
        <span>{memory.event.slug === 'solemnisation' ? t.dayOne : t.dayTwo}</span>
        <strong>{memory.guestName || t.guestMemory}</strong>
      </span>
    </button>
  )
}
