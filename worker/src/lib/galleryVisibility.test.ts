import { describe, expect, it } from 'vitest'
import { applyGalleryVisibilityUpdate, automaticGalleryMode, BOTH_DAYS_START, DAY_TWO_START, DEFAULT_GALLERY_VISIBILITY, isGalleryVisibilitySetting, resolveGalleryVisibility, visibleEventSlugs } from '../../../shared/visibility'
import type { GalleryVisibilitySetting } from '../../../shared/contracts'

describe('shared Singapore gallery visibility policy', () => {
  it.each([
    ['2026-09-23T12:00:00Z', 'solemnisation'],
    ['2027-08-21T15:59:59.999Z', 'solemnisation'],
    ['2027-08-21T16:00:00Z', 'reception'],
    ['2027-08-22T15:59:59.999Z', 'reception'],
    ['2027-08-22T16:00:00Z', 'both'],
  ])('uses the server instant %s for %s', (now, expected) => {
    expect(automaticGalleryMode(Date.parse(now))).toBe(expected)
  })

  it('expires overrides at each next scheduled boundary and changes revision', () => {
    const first = Date.parse('2027-08-21T04:00:00Z')
    const override = applyGalleryVisibilityUpdate(DEFAULT_GALLERY_VISIBILITY, { control: 'manual', mode: 'both' }, first)
    expect(override).toMatchObject({ control: 'manual', mode: 'both', lastSingleDay: 'solemnisation', overrideUntil: DAY_TWO_START })
    const before = resolveGalleryVisibility(override, first)
    const atBoundary = resolveGalleryVisibility(override, Date.parse(DAY_TWO_START))
    expect(atBoundary).toMatchObject({ control: 'automatic', effectiveMode: 'reception', nextTransitionAt: BOTH_DAYS_START, overrideUntil: null })
    expect(atBoundary.revision).not.toBe(before.revision)
    const second = applyGalleryVisibilityUpdate(override, { control: 'manual', mode: 'solemnisation' }, Date.parse(DAY_TWO_START))
    expect(second.overrideUntil).toBe(BOTH_DAYS_START)
    expect(resolveGalleryVisibility(second, Date.parse(BOTH_DAYS_START))).toMatchObject({ control: 'automatic', effectiveMode: 'both', nextTransitionAt: null })
  })

  it('remembers the last single day when Both is enabled and permits post-wedding manual control', () => {
    const now = Date.parse('2027-08-23T01:00:00+08:00')
    const single = applyGalleryVisibilityUpdate(DEFAULT_GALLERY_VISIBILITY, { control: 'manual', mode: 'reception' }, now)
    const both = applyGalleryVisibilityUpdate(single, { control: 'manual', mode: 'both' }, now)
    expect(both).toEqual({ control: 'manual', mode: 'both', lastSingleDay: 'reception', overrideUntil: null })
    expect(visibleEventSlugs(both.mode)).toEqual(['solemnisation', 'reception'])
    expect(applyGalleryVisibilityUpdate(both, { control: 'automatic' }, now)).toMatchObject({ control: 'automatic', mode: 'both', overrideUntil: null })
  })

  it('restores the preceding automatic single day after the final scheduled transition', () => {
    const now = Date.parse(BOTH_DAYS_START)
    expect(resolveGalleryVisibility(DEFAULT_GALLERY_VISIBILITY, now).lastSingleDay).toBe('reception')
    expect(applyGalleryVisibilityUpdate(DEFAULT_GALLERY_VISIBILITY, { control: 'manual', mode: 'both' }, now).lastSingleDay).toBe('reception')
    const manual = applyGalleryVisibilityUpdate(DEFAULT_GALLERY_VISIBILITY, { control: 'manual', mode: 'solemnisation' }, Date.parse(DAY_TWO_START))
    expect(resolveGalleryVisibility(manual, now).lastSingleDay).toBe('solemnisation')
  })

  it.each([null, [], {}, { ...DEFAULT_GALLERY_VISIBILITY, mode: 'all' }, { ...DEFAULT_GALLERY_VISIBILITY, lastSingleDay: 'both' },
    { ...DEFAULT_GALLERY_VISIBILITY, control: 'manual', overrideUntil: 'tomorrow' },
    { ...DEFAULT_GALLERY_VISIBILITY, overrideUntil: DAY_TWO_START }])('rejects corrupt persisted policy %j', (setting) => {
    expect(isGalleryVisibilitySetting(setting)).toBe(false)
  })

  it('keeps the deployment drain mode manual until explicitly activated', () => {
    const drain: GalleryVisibilitySetting = { control: 'manual', mode: 'both', lastSingleDay: 'solemnisation', overrideUntil: null }
    expect(resolveGalleryVisibility(drain, Date.parse('2027-08-21T00:00:00Z')).effectiveMode).toBe('both')
  })
})
