import type { GalleryDownloadStatus } from '../../../shared/contracts'

const EXPLICIT_TIMEZONE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/
const CONFIGURATION_ERROR = 'DOWNLOADS_AVAILABLE_AT must be a valid ISO 8601 timestamp with an explicit timezone'

export function parseDownloadAvailabilityTimestamp(value: string) {
  const match = EXPLICIT_TIMEZONE_TIMESTAMP.exec(value || '')
  if (!match) throw new Error(CONFIGURATION_ERROR)

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , , offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = Number(offsetHourText || 0)
  const offsetMinute = Number(offsetMinuteText || 0)
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0

  if (
    year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)
  ) throw new Error(CONFIGURATION_ERROR)

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(CONFIGURATION_ERROR)
  return timestamp
}

export function getGalleryDownloadStatus(availableAt: string, now = Date.now()): GalleryDownloadStatus {
  const releaseTimestamp = parseDownloadAvailabilityTimestamp(availableAt)
  return {
    available: now >= releaseTimestamp,
    availableAt,
    serverTime: new Date(now).toISOString(),
  }
}
