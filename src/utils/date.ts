import type { EventSlug, GalleryDayMode } from '../../shared/contracts'

export function singaporeDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { year: get('year'), month: get('month'), day: get('day') }
}

export function getSingaporeEventDefault(now = new Date()): EventSlug | null {
  const { year, month, day } = singaporeDateParts(now)
  if (year === '2027' && month === '08' && day === '21') return 'solemnisation'
  if (year === '2027' && month === '08' && day === '22') return 'reception'
  return null
}

export const eventDateLabel = (slug: EventSlug, locale: 'en' | 'ms') => {
  return `${slug === 'solemnisation' ? '21' : '22'} ${locale === 'ms' ? 'Ogos' : 'August'} 2027`
}

export function galleryDateLabel(mode: GalleryDayMode | null, locale: 'en' | 'ms', compact = false) {
  if (!mode) return locale === 'ms' ? 'Perkahwinan Kami' : 'Our Wedding'
  const day = mode === 'both' ? '21 — 22' : mode === 'solemnisation' ? '21' : '22'
  return `${day} ${locale === 'ms' ? 'Ogos' : compact ? 'Aug' : 'August'} 2027`
}

/** Our Flight's codes for each wedding day, used as boarding-pass details. */
export const flightCode = (slug: EventSlug) => slug === 'solemnisation' ? 'AN2108' : 'AN2208'

/** Flight codes for the days the gallery has revealed; none before a day is confirmed. */
export function flightCodes(mode: GalleryDayMode | null) {
  if (mode === 'solemnisation' || mode === 'reception') return [flightCode(mode)]
  if (mode === 'both') return [flightCode('solemnisation'), flightCode('reception')]
  return []
}
