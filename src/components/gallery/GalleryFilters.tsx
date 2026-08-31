import type { EventSlug } from '../../../shared/contracts'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'

export type GalleryFilterState = { event: EventSlug | 'all'; type: 'photo' | 'video' | 'all' }

export function GalleryFilters({ value, onChange }: { value: GalleryFilterState; onChange: (next: GalleryFilterState) => void }) {
  const { locale } = useLocale()
  const t = copy[locale].gallery

  return (
    <div className="gallery-filters" aria-label={t.filterAria}>
      <div className="filter-group" aria-label={t.celebrationAria}>
        {([
          ['all', t.allMemories],
          ['solemnisation', t.dayOne],
          ['reception', t.dayTwo],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={value.event === key} onClick={() => onChange({ ...value, event: key })}>{label}</button>
        ))}
      </div>
      <span className="filter-divider" aria-hidden="true" />
      <div className="filter-group" aria-label={t.mediaAria}>
        {([
          ['all', t.all],
          ['photo', t.photos],
          ['video', t.videos],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={value.type === key} onClick={() => onChange({ ...value, type: key })}>{label}</button>
        ))}
      </div>
    </div>
  )
}
