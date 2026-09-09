import { describe, expect, it } from 'vitest'
import { getGalleryDownloadStatus, parseDownloadAvailabilityTimestamp } from './downloadAvailability'

const RELEASE_AT = '2027-08-23T00:00:00+08:00'

describe('gallery download availability', () => {
  it('parses the Singapore release instant with its explicit UTC offset', () => {
    expect(parseDownloadAvailabilityTimestamp(RELEASE_AT)).toBe(Date.parse('2027-08-22T16:00:00.000Z'))
  })

  it.each([
    '',
    '2027-08-23T00:00:00',
    '2027-02-30T00:00:00+08:00',
    '2027-08-23T24:00:00+08:00',
    '2027-08-23T00:00:00+14:01',
  ])('rejects a missing or malformed release timestamp: %s', (value) => {
    expect(() => parseDownloadAvailabilityTimestamp(value)).toThrowError(/DOWNLOADS_AVAILABLE_AT/)
  })

  it('is unavailable before the boundary and available inclusively at and after it', () => {
    expect(getGalleryDownloadStatus(RELEASE_AT, Date.parse('2027-08-22T15:59:59.999Z'))).toMatchObject({ available: false, availableAt: RELEASE_AT })
    expect(getGalleryDownloadStatus(RELEASE_AT, Date.parse('2027-08-22T16:00:00.000Z'))).toMatchObject({ available: true, availableAt: RELEASE_AT })
    expect(getGalleryDownloadStatus(RELEASE_AT, Date.parse('2027-08-22T16:00:00.001Z'))).toMatchObject({ available: true, availableAt: RELEASE_AT })
  })
})
