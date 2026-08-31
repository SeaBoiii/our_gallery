import { Check } from 'lucide-react'
import type { EventSlug, GalleryEvent } from '../../../shared/contracts'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'

const events = [{ slug: 'solemnisation' as const }, { slug: 'reception' as const }]

export function EventSelector({ value, onChange, events: availability }: { value: EventSlug | null; onChange: (value: EventSlug) => void; events?: GalleryEvent[] | null }) {
  const { locale } = useLocale()
  const t = copy[locale].upload

  return (
    <div className="event-selector" role="radiogroup" aria-label={t.celebrationLabel}>
      <p className="departure-label"><span>{t.departures}</span><span>{t.singaporeTime}</span></p>
      {events.map((event) => {
        const enabled = availability?.find((candidate) => candidate.slug === event.slug)?.uploadEnabled ?? true
        return (
        <button key={event.slug} type="button" role="radio" aria-checked={value === event.slug} disabled={!enabled} onClick={() => onChange(event.slug)}>
          <span className="event-gate">{event.slug === 'solemnisation' ? t.dayOne : t.dayTwo}</span>
          <span><small>{event.slug === 'solemnisation' ? t.dateOne : t.dateTwo}</small><strong>{event.slug === 'solemnisation' ? t.solemnisation : t.reception}</strong></span>
          <span className="event-status">{enabled ? t.onTime : t.closed}</span>
          <span className="event-check">{value === event.slug ? <Check aria-hidden="true" size={15} /> : null}</span>
        </button>
        )
      })}
    </div>
  )
}
