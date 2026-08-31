import type { EventSlug } from '../../shared/contracts'

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
  if (slug === 'solemnisation') return locale === 'ms' ? '21 Ogos — Akad Nikah' : '21 Aug — Solemnisation'
  return locale === 'ms' ? '22 Ogos — Resepsi Pengantin Lelaki' : "22 Aug — Groom's Reception"
}
