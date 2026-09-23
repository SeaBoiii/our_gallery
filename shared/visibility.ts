import type { AdminGalleryVisibility, EventSlug, GalleryDayMode, GalleryVisibilitySetting, GalleryVisibilityUpdate } from './contracts'

export const DAY_TWO_START = '2027-08-22T00:00:00+08:00'
export const BOTH_DAYS_START = '2027-08-23T00:00:00+08:00'
export const PUBLIC_CONFIG_MAX_AGE_MS = 30_000
export const DEFAULT_GALLERY_VISIBILITY: GalleryVisibilitySetting = {
  control: 'automatic', mode: 'solemnisation', lastSingleDay: 'solemnisation', overrideUntil: null,
}

export const isGalleryDayMode = (value: unknown): value is GalleryDayMode => value === 'solemnisation' || value === 'reception' || value === 'both'

export function automaticGalleryMode(now = Date.now()): GalleryDayMode {
  if (now >= Date.parse(BOTH_DAYS_START)) return 'both'
  return now >= Date.parse(DAY_TWO_START) ? 'reception' : 'solemnisation'
}

export function nextGalleryTransitionAt(now = Date.now()): string | null {
  if (now < Date.parse(DAY_TWO_START)) return DAY_TWO_START
  return now < Date.parse(BOTH_DAYS_START) ? BOTH_DAYS_START : null
}

export function visibleEventSlugs(mode: GalleryDayMode): EventSlug[] {
  return mode === 'both' ? ['solemnisation', 'reception'] : [mode]
}

export function isGalleryVisibilitySetting(value: unknown): value is GalleryVisibilitySetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const setting = value as Record<string, unknown>
  return (setting.control === 'automatic' || setting.control === 'manual') && isGalleryDayMode(setting.mode)
    && (setting.lastSingleDay === null || setting.lastSingleDay === 'solemnisation' || setting.lastSingleDay === 'reception')
    && (setting.overrideUntil === null || (typeof setting.overrideUntil === 'string'
      && /(?:Z|[+-]\d{2}:\d{2})$/.test(setting.overrideUntil) && Number.isFinite(Date.parse(setting.overrideUntil))))
    && (setting.control !== 'automatic' || setting.overrideUntil === null)
}

/** An expired manual override becomes automatic without a scheduled database write. */
export function resolveGalleryVisibility(setting: GalleryVisibilitySetting, now = Date.now(), revision = ''): AdminGalleryVisibility {
  const manual = setting.control === 'manual' && (setting.overrideUntil === null || now < Date.parse(setting.overrideUntil))
  const mode = manual ? setting.mode : automaticGalleryMode(now)
  const scheduled = nextGalleryTransitionAt(now)
  const nextTransitionAt = manual && setting.overrideUntil && (!scheduled || Date.parse(setting.overrideUntil) < Date.parse(scheduled))
    ? setting.overrideUntil : scheduled
  const manualUntilFinalTransition = setting.control === 'manual' && setting.overrideUntil !== null
    && Date.parse(setting.overrideUntil) === Date.parse(BOTH_DAYS_START)
  const lastSingleDay = manual ? setting.lastSingleDay : mode !== 'both' ? mode
    : manualUntilFinalTransition ? setting.lastSingleDay : 'reception'
  return {
    control: manual ? 'manual' : 'automatic', mode, lastSingleDay,
    overrideUntil: manual ? setting.overrideUntil : null, effectiveMode: mode,
    serverTime: new Date(now).toISOString(), nextTransitionAt,
    revision: [revision, setting.control, setting.mode, setting.lastSingleDay ?? '', setting.overrideUntil ?? '', mode].join('|'),
  }
}

export function applyGalleryVisibilityUpdate(current: GalleryVisibilitySetting, update: GalleryVisibilityUpdate, now = Date.now()): GalleryVisibilitySetting {
  const previous = resolveGalleryVisibility(current, now)
  const lastSingleDay = previous.effectiveMode === 'both' ? previous.lastSingleDay : previous.effectiveMode
  if (update.control === 'automatic') return {
    control: 'automatic', mode: automaticGalleryMode(now), lastSingleDay, overrideUntil: null,
  }
  return {
    control: 'manual', mode: update.mode,
    lastSingleDay: update.mode === 'both' ? lastSingleDay : update.mode,
    overrideUntil: nextGalleryTransitionAt(now),
  }
}
