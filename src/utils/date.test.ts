import { describe, expect, it } from 'vitest'
import { getSingaporeEventDefault } from './date'

describe('Singapore wedding day selection', () => {
  it('defaults to the solemnisation on 21 August in Singapore', () => {
    expect(getSingaporeEventDefault(new Date('2027-08-20T16:01:00.000Z'))).toBe('solemnisation')
  })

  it('defaults to the reception on 22 August in Singapore', () => {
    expect(getSingaporeEventDefault(new Date('2027-08-21T16:01:00.000Z'))).toBe('reception')
  })

  it('asks the guest outside the two wedding dates', () => {
    expect(getSingaporeEventDefault(new Date('2027-08-23T02:00:00.000Z'))).toBeNull()
  })
})
