import { Check } from 'lucide-react'
import type { EventSlug, GalleryEvent } from '../../../shared/contracts'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'
import { eventDateLabel } from '../../utils/date'

export function EventSelector({ value, onChange, events }: { value: EventSlug | null; onChange: (value: EventSlug) => void; events: GalleryEvent[] | null }) {
  const { locale } = useLocale()
  const t = copy[locale].upload
  if (!events || events.length < 2) return null
  return (
    <div className="event-selector" role="radiogroup" aria-label={t.celebrationLabel}>
      <p className="departure-label"><span>{t.departures}</span><span>{t.singaporeTime}</span></p>
      {events.map(event => <button key={event.id} type="button" role="radio" aria-checked={value === event.slug} disabled={!event.uploadEnabled} onClick={() => onChange(event.slug)}>
        <span className="event-gate">{event.eventDate.slice(-2)}</span>
        <span><small>{eventDateLabel(event.slug, locale)}</small><strong>{locale === 'en' ? 'Our Wedding' : 'Perkahwinan Kami'}</strong></span>
        <span className="event-status">{event.uploadEnabled ? t.onTime : t.closed}</span>
        <span className="event-check">{value === event.slug ? <Check aria-hidden="true" size={15} /> : null}</span>
      </button>)}
    </div>
  )
}
