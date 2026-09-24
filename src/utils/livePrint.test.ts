import { describe, expect, it } from 'vitest'
import { fitLivePrint, mediaAspectRatio } from './livePrint'

describe('fitted live photo mats', () => {
  it.each([['portrait', 2 / 3], ['landscape', 3 / 2], ['square', 1], ['panorama', 5], ['tall strip', 1 / 3]] as const)(
    'hugs a %s image while retaining the mat and caption', (_name, aspect) => {
      const fitted = fitLivePrint({ width: 500, height: 380 }, aspect, { width: 24, height: 51 })!
      expect((fitted.width - 24) / (fitted.height - 51)).toBeCloseTo(aspect, 10)
      expect(fitted.width).toBeLessThanOrEqual(500)
      expect(fitted.height).toBeLessThanOrEqual(380)
      expect(Math.max(fitted.width / 500, fitted.height / 380)).toBeCloseTo(1, 10)
    },
  )

  it.each([-8, -3, 0, 3, 8])('keeps the entire rotated frame inside the available box at %s degrees', rotation => {
    const fitted = fitLivePrint({ width: 240, height: 165 }, 2 / 3, { width: 18, height: 38 }, rotation)!
    expect((fitted.width - 18) / (fitted.height - 38)).toBeCloseTo(2 / 3, 10)
    expect(fitted.boundsWidth).toBeLessThanOrEqual(240 + 1e-9)
    expect(fitted.boundsHeight).toBeLessThanOrEqual(165 + 1e-9)
    expect(Math.max(fitted.boundsWidth / 240, fitted.boundsHeight / 165)).toBeCloseTo(1, 10)
  })

  it('grows again after a smaller mobile layout without carrying an earlier height limit', () => {
    const small = fitLivePrint({ width: 150, height: 420 }, 1.5, { width: 24, height: 51 })!
    const large = fitLivePrint({ width: 320, height: 420 }, 1.5, { width: 24, height: 51 })!
    expect(large.height).toBeGreaterThan(small.height)
    expect(large.width).toBeCloseTo(320)
  })

  it('rejects unknown dimensions and boxes too small for the mat instead of producing invalid CSS', () => {
    expect(mediaAspectRatio(null, null)).toBeNull()
    expect(mediaAspectRatio(0, 1200)).toBeNull()
    expect(mediaAspectRatio(Infinity, 1200)).toBeNull()
    expect(mediaAspectRatio(-800, 1200)).toBeNull()
    expect(mediaAspectRatio(800, 1200)).toBe(2 / 3)
    expect(fitLivePrint({ width: 0, height: 380 }, 1, { width: 24, height: 51 })).toBeNull()
    expect(fitLivePrint({ width: 20, height: 30 }, 1, { width: 24, height: 51 })).toBeNull()
    expect(fitLivePrint({ width: 500, height: 380 }, NaN, { width: 24, height: 51 })).toBeNull()
  })
})
