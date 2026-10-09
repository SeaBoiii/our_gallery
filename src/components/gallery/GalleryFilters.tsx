import type { EventSlug, GalleryDayMode } from '../../../shared/contracts'
import type { ReactNode } from 'react'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'
import { flightCode } from '../../utils/date'

/** `type` stays in the state shape for the API query; guests now browse photographs only. */
export type GalleryFilterState = { event: EventSlug | 'all'; type: 'photo' | 'video' | 'all' }

export function GalleryFilters({ value, onChange, children, mode = 'both' }: { value: GalleryFilterState; onChange: (next: GalleryFilterState) => void; children?: ReactNode; mode?: GalleryDayMode }) {
  const { locale } = useLocale()
  const t = copy[locale].gallery
  const english = locale === 'en'

  return (
    <div className="gallery-filters" role="group" aria-label={t.filterAria}>
      {mode === 'both' ? <div className="gallery-chapters" role="group" aria-label={t.celebrationAria}>
        {([
          ['all', 'A & N', english ? 'All moments' : 'Semua detik', english ? 'Both days' : 'Kedua-dua hari'],
          ['solemnisation', flightCode('solemnisation'), english ? '21 August' : '21 Ogos', '2027'],
          ['reception', flightCode('reception'), english ? '22 August' : '22 Ogos', '2027'],
        ] as const).map(([key, code, label, description]) => (
          <button key={key} type="button" aria-label={label} aria-pressed={value.event === key} onClick={() => onChange({ ...value, event: key })}>
            <span className="chapter-label">{code}</span><strong>{label}</strong><span className="chapter-description">{description}</span>
          </button>
        ))}
      </div> : null}
      {children ? <div className="gallery-filter-bar">{children}</div> : null}
    </div>
  )
}
