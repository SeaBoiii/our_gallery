import type { EventSlug, GalleryDayMode } from '../../../shared/contracts'
import type { ReactNode } from 'react'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'

export type GalleryFilterState = { event: EventSlug | 'all'; type: 'photo' | 'video' | 'all' }

export function GalleryFilters({ value, onChange, children, mode = 'both' }: { value: GalleryFilterState; onChange: (next: GalleryFilterState) => void; children?: ReactNode; mode?: GalleryDayMode }) {
  const { locale } = useLocale()
  const t = copy[locale].gallery

  return (
    <div className="gallery-filters" role="group" aria-label={t.filterAria}>
      {mode === 'both' ? <div className="gallery-chapters" role="group" aria-label={t.celebrationAria}>
        {([
          ['all', locale === 'en' ? 'Our Wedding' : 'Perkahwinan Kami', locale === 'en' ? 'All moments' : 'Semua detik', locale === 'en' ? 'A lifetime of memories.' : 'Kenangan seumur hidup.'],
          ['solemnisation', locale === 'en' ? 'Our Wedding' : 'Perkahwinan Kami', locale === 'en' ? '21 August' : '21 Ogos', '2027'],
          ['reception', locale === 'en' ? 'Our Wedding' : 'Perkahwinan Kami', locale === 'en' ? '22 August' : '22 Ogos', '2027'],
        ] as const).map(([key, chapter, label, description]) => (
          <button key={key} type="button" aria-label={label} aria-pressed={value.event === key} onClick={() => onChange({ ...value, event: key })}>
            <span className="chapter-label">{chapter}</span><strong>{label}</strong><span className="chapter-description">{description}</span>
          </button>
        ))}
      </div> : null}
      <div className="gallery-filter-bar">
      <div className="filter-group gallery-media-filters" role="group" aria-label={t.mediaAria}>
        {([
          ['all', t.all],
          ['photo', t.photos],
          ['video', t.videos],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={value.type === key} onClick={() => onChange({ ...value, type: key })}>{label}</button>
        ))}
      </div>
      {children}
      </div>
    </div>
  )
}
