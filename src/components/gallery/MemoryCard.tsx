import { Film, Heart, Play } from 'lucide-react'
import type { GalleryMedia } from '../../../shared/contracts'
import { USE_MOCK_DATA } from '../../config'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'

export function MemoryCard({ memory, onOpen, favourite, onToggleFavourite }: { memory: GalleryMedia; onOpen: () => void; favourite: boolean; onToggleFavourite: () => void }) {
  const { locale } = useLocale()
  const t = copy[locale].gallery
  const ratio = memory.width && memory.height ? `${memory.width} / ${memory.height}` : '4 / 5'
  const eventName = memory.event.slug === 'solemnisation' ? t.solemnisation : t.reception
  const description = memory.altText || memory.guestMessage || `${t.guestMemory} ${t.from} ${eventName}`
  return (
    <article className="memory-card">
      <button className="memory-open" type="button" onClick={onOpen} aria-label={`${t.open}: ${description}`}>
        <span className="memory-frame" style={{ aspectRatio: ratio }}>
        {memory.thumbnailUrl ? <img
          src={memory.thumbnailUrl}
          alt={description}
          loading="lazy"
          decoding="async"
          onError={(event) => { event.currentTarget.src = '/clouds-768.webp' }}
        /> : <span className="video-placeholder"><Film aria-hidden="true" /><small>{t.videoMemory}</small></span>}
        {memory.mediaType === 'video' ? <span className="video-badge"><Play aria-hidden="true" size={14} fill="currentColor" /> {t.videos}</span> : null}
        {USE_MOCK_DATA ? <span className="sample-badge">{t.preview}</span> : null}
        </span>
        <span className="memory-caption">
          <span>{memory.event.slug === 'solemnisation' ? t.dayOne : t.dayTwo}</span>
          <strong>{memory.guestName || t.guestMemory}</strong>
        </span>
      </button>
      <button className={`memory-favourite${favourite ? ' is-favourite' : ''}`} type="button" onClick={onToggleFavourite} aria-pressed={favourite} aria-label={favourite ? t.removeFavourite : t.addFavourite}>
        <Heart aria-hidden="true" fill={favourite ? 'currentColor' : 'none'} />
      </button>
    </article>
  )
}
