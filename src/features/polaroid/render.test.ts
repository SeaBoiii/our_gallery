import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoothLayout, BoothPhoto, BoothSettings, LoadedPhoto, PolaroidSettings } from './types'

const { convertHeic } = vi.hoisted(() => ({ convertHeic: vi.fn() }))
vi.mock('heic2any', () => ({ default: convertHeic }))

let renderer: typeof import('./render')
let bitmapDecode: ReturnType<typeof vi.fn>
let revokeUrl: ReturnType<typeof vi.fn<(url: string) => void>>
let failLocalImage: boolean
let failAssets: boolean
let deferAssets: boolean
let imageSources: string[]
let pendingAssets: (() => void)[]
let contexts: MockContext[]
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
type TextRun = { text: string; x: number; y: number; maxWidth: number; fontSize: number; font: string; fillStyle: string }
type PathPoint = { kind: 'move' | 'line'; x: number; y: number }
type StrokeRun = { points: PathPoint[]; color: string; width: number }

function makeContext() {
  return {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '', globalAlpha: 1,
    imageSmoothingEnabled: false, imageSmoothingQuality: '',
    drawImage: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    pathPoints: [] as PathPoint[], strokeRuns: [] as StrokeRun[],
    beginPath: vi.fn(function (this: { pathPoints: PathPoint[] }) { this.pathPoints = [] }),
    rect: vi.fn(), clip: vi.fn(),
    moveTo: vi.fn(function (this: { pathPoints: PathPoint[] }, x: number, y: number) { this.pathPoints.push({ kind: 'move', x, y }) }),
    lineTo: vi.fn(function (this: { pathPoints: PathPoint[] }, x: number, y: number) { this.pathPoints.push({ kind: 'line', x, y }) }),
    stroke: vi.fn(function (this: { pathPoints: PathPoint[]; strokeRuns: StrokeRun[]; strokeStyle: string; lineWidth: number }) {
      this.strokeRuns.push({ points: [...this.pathPoints], color: this.strokeStyle, width: this.lineWidth })
    }),
    translate: vi.fn(), rotate: vi.fn(), putImageData: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([100, 150, 200, 255]) })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    textRuns: [] as TextRun[],
    fillText: vi.fn(function (this: { font: string; fillStyle: string; textRuns: TextRun[] }, text: string, x: number, y: number, maxWidth: number) {
      this.textRuns.push({ text, x, y, maxWidth, fontSize: Number(this.font.match(/([\d.]+)px/)?.[1] ?? 20), font: this.font, fillStyle: this.fillStyle })
    }),
    measureText(text: string) { return { width: Array.from(text).length * Number(this.font.match(/([\d.]+)px/)?.[1] ?? 20) * 0.55 } },
  }
}
type MockContext = ReturnType<typeof makeContext>

function bitmap(width = 2400, height = 1800) {
  return { width, height, close: vi.fn() }
}

function settings(values: Partial<PolaroidSettings> = {}): PolaroidSettings {
  return { ...renderer.DEFAULT_POLAROID_SETTINGS, celebration: 'solemnisation', ...values }
}

function photo(width = 4000, height = 3000): LoadedPhoto {
  return { source: document.createElement('canvas'), width, height, dispose: vi.fn() }
}

function boothSettings(values: Partial<BoothSettings> = {}): BoothSettings {
  return { ...renderer.DEFAULT_BOOTH_SETTINGS, celebration: 'solemnisation', ...values }
}

function boothPhotos(count = 4): BoothPhoto[] {
  return Array.from({ length: count }, () => ({ photo: photo(), crop: { ...renderer.DEFAULT_PHOTO_CROP } }))
}

beforeEach(async () => {
  vi.resetModules()
  convertHeic.mockReset()
  failLocalImage = false
  failAssets = false
  deferAssets = false
  imageSources = []
  pendingAssets = []
  contexts = []
  bitmapDecode = vi.fn().mockResolvedValue(bitmap())
  revokeUrl = vi.fn()
  vi.stubGlobal('createImageBitmap', bitmapDecode)
  vi.stubGlobal('Image', class {
    naturalWidth = 599
    naturalHeight = 381
    onload: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    value = ''
    set src(value: string) {
      this.value = value
      if (!value) return
      imageSources.push(value)
      const local = value.startsWith('blob:')
      const callback = () => {
        if (local ? failLocalImage : failAssets) this.onerror?.(new Event('error'))
        else this.onload?.(new Event('load'))
      }
      if (!local && deferAssets) pendingAssets.push(callback)
      else queueMicrotask(callback)
    }
    get src() { return this.value }
  })
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:local-photo')
    static revokeObjectURL = (url: string) => { revokeUrl(url) }
  })
  const canvasContexts = new WeakMap<HTMLCanvasElement, MockContext>()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let context = canvasContexts.get(this)
    if (!context) {
      context = makeContext()
      canvasContexts.set(this, context)
      contexts.push(context)
    }
    return context as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load: vi.fn().mockResolvedValue([{}]) } })
  renderer = await import('./render')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else Reflect.deleteProperty(document, 'fonts')
})

describe('photo crop and panning', () => {
  it.each([0, 90, 180, 270] as const)('keeps every crop within a landscape source at rotation %i', (rotation) => {
    for (const zoom of [1, 1.25, 3]) {
      for (const positionX of [-1, 0, 1]) {
        for (const positionY of [-1, 0, 1]) {
          const geometry = renderer.getPhotoGeometry(4000, 3000, settings({ rotation, zoom, positionX, positionY }))
          const sideways = rotation === 90 || rotation === 270
          expect(geometry.sourceCrop.x).toBeGreaterThanOrEqual(0)
          expect(geometry.sourceCrop.y).toBeGreaterThanOrEqual(0)
          expect(geometry.sourceCrop.x + geometry.sourceCrop.width).toBeLessThanOrEqual((sideways ? 3000 : 4000) + 0.00001)
          expect(geometry.sourceCrop.y + geometry.sourceCrop.height).toBeLessThanOrEqual((sideways ? 4000 : 3000) + 0.00001)
          expect(geometry.rotatedDrawWidth).toBeGreaterThanOrEqual(renderer.PHOTO_RECT.width)
          expect(geometry.rotatedDrawHeight).toBeGreaterThanOrEqual(renderer.PHOTO_RECT.height)
        }
      }
    }
  })

  it('cover crops a portrait and a landscape from their center without stretching', () => {
    expect(renderer.getPhotoGeometry(4000, 3000, settings()).sourceCrop).toEqual({ x: 500, y: 0, width: 3000, height: 3000 })
    expect(renderer.getPhotoGeometry(3000, 4000, settings()).sourceCrop).toEqual({ x: 0, y: 500, width: 3000, height: 3000 })
    const square = renderer.getPhotoGeometry(600, 600, settings({ zoom: 2 }))
    expect(square.sourceCrop).toEqual({ x: 150, y: 150, width: 300, height: 300 })
  })

  it('converts output-pixel drag distance after rotation and stops at the crop edge', () => {
    expect(renderer.positionDelta(photo(), settings(), 88, 300)).toEqual({ positionX: 0.5, positionY: 0 })
    expect(renderer.positionDelta(photo(), settings({ rotation: 90 }), 300, 88)).toEqual({ positionX: 0, positionY: 0.5 })
    expect(renderer.positionDelta(photo(), settings({ positionX: 0.8 }), 1000, -1000)).toEqual({ positionX: 1, positionY: 0 })
    expect(renderer.positionDelta(photo(2000, 2000), settings({ zoom: 2 }), -264, 264)).toEqual({ positionX: -0.5, positionY: 0.5 })
  })

  it('normalizes bad settings and rejects invalid decoded image dimensions', () => {
    const normalized = renderer.normalizeSettings(settings({ zoom: Infinity, positionX: 99, positionY: NaN, rotation: 45 as 0,
      caption: `  Our\n day  ${'💛'.repeat(80)}` }))
    expect(normalized).toMatchObject({ zoom: 1, positionX: 1, positionY: 0, rotation: 0 })
    expect(normalized.caption.startsWith('Our day ')).toBe(true)
    expect(Array.from(normalized.caption)).toHaveLength(60)
    expect(normalized.caption.endsWith('💛')).toBe(true)
    expect(() => renderer.getPhotoGeometry(0, 100, settings())).toThrow(/invalid dimensions/)
    expect(() => renderer.getPhotoGeometry(100, NaN, settings())).toThrow(/invalid dimensions/)
  })
})

describe('local photo loading and resource ownership', () => {
  it('validates file size and actual MIME before invoking a decoder', async () => {
    const tooLarge = new File(['photo'], 'large.jpg', { type: 'image/jpeg' })
    Object.defineProperty(tooLarge, 'size', { value: renderer.MAX_PHOTO_BYTES + 1 })
    await expect(renderer.loadPolaroidPhoto(tooLarge)).rejects.toMatchObject({ code: 'size' })
    await expect(renderer.loadPolaroidPhoto(new File([], 'empty.png', { type: 'image/png' }))).rejects.toMatchObject({ code: 'size' })
    await expect(renderer.loadPolaroidPhoto(new File(['svg'], 'image.jpg', { type: 'image/svg+xml' }))).rejects.toMatchObject({ code: 'format' })
    expect(bitmapDecode).not.toHaveBeenCalled()
  })

  it('uses native orientation decoding and closes its bitmap exactly once', async () => {
    const decoded = bitmap(1800, 2400)
    bitmapDecode.mockResolvedValue(decoded)
    const file = new File(['photo'], 'phone.JPEG')
    const loaded = await renderer.loadPolaroidPhoto(file)
    expect(bitmapDecode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
    expect(loaded).toMatchObject({ source: decoded, width: 1800, height: 2400 })
    loaded.dispose()
    loaded.dispose()
    expect(decoded.close).toHaveBeenCalledTimes(1)
    expect(imageSources).toEqual([])
  })

  it('tries native HEIC decoding before loading the conversion library', async () => {
    await renderer.loadPolaroidPhoto(new File(['heic'], 'phone.heic', { type: 'image/heic' }))
    expect(bitmapDecode).toHaveBeenCalledTimes(1)
    expect(convertHeic).not.toHaveBeenCalled()
  })

  it('falls back to HEIC conversion only after native decoders fail, releasing failed URLs', async () => {
    const converted = new Blob(['jpeg'], { type: 'image/jpeg' })
    bitmapDecode.mockRejectedValueOnce(new Error('unsupported')).mockResolvedValueOnce(bitmap())
    failLocalImage = true
    convertHeic.mockResolvedValue([converted])
    const file = new File(['heic'], 'phone.heic', { type: 'image/heic' })
    const loaded = await renderer.loadPolaroidPhoto(file)
    expect(convertHeic).toHaveBeenCalledWith({ blob: file, toType: 'image/jpeg', quality: 0.95 })
    expect(bitmapDecode).toHaveBeenLastCalledWith(converted, { imageOrientation: 'from-image' })
    expect(revokeUrl).toHaveBeenCalledWith('blob:local-photo')
    expect(loaded.width).toBe(2400)
  })

  it('retains a native image object URL only until disposal', async () => {
    bitmapDecode.mockRejectedValue(new Error('no bitmap support'))
    const loaded = await renderer.loadPolaroidPhoto(new File(['photo'], 'photo.png', { type: 'image/png' }))
    expect(imageSources).toEqual(['blob:local-photo'])
    expect(revokeUrl).not.toHaveBeenCalled()
    loaded.dispose()
    loaded.dispose()
    expect(revokeUrl).toHaveBeenCalledTimes(1)
    expect((loaded.source as HTMLImageElement).src).toBe('')
  })

  it('reports undecodable local photos and frees their object URL', async () => {
    bitmapDecode.mockRejectedValue(new Error('bad data'))
    failLocalImage = true
    await expect(renderer.loadPolaroidPhoto(new File(['invalid'], 'broken.webp', { type: 'image/webp' })))
      .rejects.toMatchObject({ code: 'decode', message: expect.stringContaining('could not be opened') })
    expect(revokeUrl).toHaveBeenCalledTimes(1)
  })

  it.each([
    [6000, 4000, 2400, 1600],
    [4000, 6000, 1600, 2400],
    [5000, 5000, 2400, 2400],
  ])('caps a %i×%i source at 2400 pixels and releases both raster resources', async (width, height, resizedWidth, resizedHeight) => {
    const decoded = bitmap(width, height)
    bitmapDecode.mockResolvedValue(decoded)
    const loaded = await renderer.loadPolaroidPhoto(new File(['photo'], 'large.jpg', { type: 'image/jpeg' }))
    expect(loaded).toMatchObject({ width: resizedWidth, height: resizedHeight })
    expect(Math.max(loaded.width, loaded.height)).toBe(2400)
    expect(loaded.width * loaded.height * 4).toBeLessThanOrEqual(2400 * 2400 * 4)
    expect(loaded.width / loaded.height).toBeCloseTo(width / height)
    expect(decoded.close).toHaveBeenCalledTimes(1)
    expect(contexts[0].drawImage).toHaveBeenCalledWith(decoded, 0, 0, resizedWidth, resizedHeight)
    loaded.dispose()
    loaded.dispose()
    expect(decoded.close).toHaveBeenCalledTimes(1)
    expect((loaded.source as HTMLCanvasElement).width).toBe(0)
    expect((loaded.source as HTMLCanvasElement).height).toBe(0)
  })
})

describe('portable finishes and bounded captions', () => {
  it('preserves the original and the alpha channel for all finishes', () => {
    const original = new Uint8ClampedArray([100, 150, 200, 87])
    const unchanged = original.slice()
    renderer.applyPhotoFinish(unchanged, 'original')
    expect(unchanged).toEqual(original)
    const mono = original.slice()
    renderer.applyPhotoFinish(mono, 'mono')
    expect(Array.from(mono)).toEqual([143, 143, 143, 87])
    const warm = original.slice()
    renderer.applyPhotoFinish(warm, 'warm')
    expect(warm[0]).toBeGreaterThan(original[0])
    expect(warm[2]).toBeLessThan(original[2])
    expect(warm[3]).toBe(87)
  })

  it('wraps a whole caption into balanced lines without dropping text', () => {
    const caption = 'A little moment from a day full of love'
    const lines = renderer.fitCaptionLines(caption, 24, (text) => text.length)
    expect(lines).toHaveLength(2)
    expect(lines.join(' ')).toBe(caption)
    expect(lines.every((line) => line.length <= 24)).toBe(true)
    const unbroken = '💛'.repeat(60)
    const wrapped = renderer.fitCaptionLines(unbroken, 35, (text) => Array.from(text).length)
    expect(wrapped).toHaveLength(2)
    expect(wrapped.join('')).toBe(unbroken)
    expect(renderer.fitCaptionLines('', 24, (text) => text.length)).toEqual([])
  })
})

describe('shared preview and PNG renderer', () => {
  it('draws the full-resolution rotated photo and keeps caption above the wedding names', async () => {
    const canvas = document.createElement('canvas')
    const source = photo()
    const caption = 'One beautiful day, so many memories, all our favourite people'
    await renderer.drawPolaroid(canvas, source, settings({ rotation: 90, zoom: 2, caption, finish: 'mono' }))
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(1500)
    const photoContext = contexts.find((context) => context.rotate.mock.calls.length)!
    expect(photoContext.rotate).toHaveBeenCalledWith(Math.PI / 2)
    expect(photoContext.drawImage.mock.calls[0][0]).toBe(source.source)
    expect(photoContext.putImageData.mock.calls[0][0].data).toEqual(new Uint8ClampedArray([143, 143, 143, 255]))
    const output = contexts[0]
    const captionCalls = output.fillText.mock.calls.filter((call) => call[2] < 1280)
    expect(captionCalls).toHaveLength(2)
    expect(captionCalls.every((call) => call[2] <= 1248 && call[3] === 984)).toBe(true)
    const names = output.textRuns.find(run => run.text === 'Aleem')!
    expect(names.fontSize).toBe(60)
    expect(captionCalls.every(call => call[2] < names.y - names.fontSize)).toBe(true)
    expect(output.font).toContain('monospace')
    expect(document.fonts.load).toHaveBeenCalledWith('400 48px "Instrument Serif"')
    expect(document.fonts.load).toHaveBeenCalledWith('italic 400 48px "Instrument Serif"')
  })

  it('exports the same renderer as a 1200×1500 PNG and releases its temporary canvas', async () => {
    const exportCanvases: HTMLCanvasElement[] = []
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      exportCanvases.push(this)
      expect(this.width).toBe(1200)
      expect(this.height).toBe(1500)
      expect(type).toBe('image/png')
      callback(new Blob(['png-data'], { type: 'image/png' }))
    })
    const result = await renderer.exportPolaroid(photo(), settings({ celebration: 'solemnisation', frame: 'airmail' }))
    expect(result.type).toBe('image/png')
    expect(contexts.some((context) => context.fillText.mock.calls.some((call) => call[0] === '21 AUGUST 2027'))).toBe(true)
    expect(exportCanvases[0].width).toBe(0)
    expect(exportCanvases[0].height).toBe(0)
  })

  it('renders a neutral empty photo slot without adding a sample photo', async () => {
    await renderer.drawPolaroid(document.createElement('canvas'), null, settings())
    expect(contexts[0].fillRect).toHaveBeenCalledWith(72, 72, 1056, 1056)
    expect(contexts.some((context) => context.rotate.mock.calls.length)).toBe(false)
    expect(imageSources).toEqual([new URL('/monogram.png', window.location.origin).href])
  })

  it('uses only same-origin brand assets and falls back cleanly when assets and fonts fail', async () => {
    failAssets = true
    vi.mocked(document.fonts.load).mockRejectedValue(new Error('offline'))
    const canvas = document.createElement('canvas')
    await renderer.drawPolaroid(canvas, photo(), settings({ frame: 'clouds' }))
    expect(canvas.width).toBe(1200)
    expect(imageSources.map((source) => new URL(source).pathname)).toEqual(['/monogram.png', '/polaroid-clouds.png'])
    expect(imageSources.every((source) => new URL(source).origin === window.location.origin)).toBe(true)
    expect(contexts[0].textRuns.find(run => run.text === 'Aleem')?.fontSize).toBe(96)
  })

  it('caches decorative assets between previews and export', async () => {
    const canvas = document.createElement('canvas')
    await renderer.drawPolaroid(canvas, photo(), settings({ frame: 'clouds' }))
    await renderer.drawPolaroid(canvas, photo(), settings({ frame: 'clouds', zoom: 2 }))
    await renderer.exportPolaroid(photo(), settings({ frame: 'clouds' }))
    expect(imageSources).toHaveLength(2)
    expect(document.fonts.load).toHaveBeenCalledTimes(2)
    expect(vi.mocked(document.fonts.load).mock.calls.map(([font]) => font)).toEqual(['400 48px "Instrument Serif"', 'italic 400 48px "Instrument Serif"'])
  })

  it('waits for the italic font face as well as the regular face before drawing the names', async () => {
    let finishItalic!: (faces: FontFace[]) => void
    const italic = new Promise<FontFace[]>(resolve => { finishItalic = resolve })
    vi.mocked(document.fonts.load).mockImplementation(font => font.startsWith('italic') ? italic : Promise.resolve([{} as FontFace]))
    const drawing = renderer.drawPolaroid(document.createElement('canvas'), photo(), settings())
    await Promise.resolve()
    await Promise.resolve()

    expect(document.fonts.load).toHaveBeenCalledTimes(2)
    expect(contexts).toHaveLength(0)
    finishItalic([{} as FontFace])
    await drawing

    const ampersand = contexts[0].textRuns.find(run => run.text === '&')!
    expect(ampersand.font).toMatch(/^italic 400 /)
    expect(ampersand.font).toContain('"Instrument Serif"')
  })

  it('falls back consistently for all name runs if the italic face cannot be loaded', async () => {
    vi.mocked(document.fonts.load).mockImplementation(font => font.startsWith('italic') ? Promise.resolve([]) : Promise.resolve([{} as FontFace]))
    await renderer.drawPolaroid(document.createElement('canvas'), photo(), settings())

    const names = contexts[0].textRuns.filter(run => ['Aleem', '&', 'Nurulain'].includes(run.text))
    expect(names).toHaveLength(3)
    names.forEach(run => {
      expect(run.font).toContain('Georgia')
      expect(run.font).not.toContain('"Instrument Serif"')
    })
  })

  it('prevents an older async draw from overwriting newer editor settings', async () => {
    deferAssets = true
    const canvas = document.createElement('canvas')
    const old = renderer.drawPolaroid(canvas, photo(), settings({ caption: 'Old caption', frame: 'clouds' }))
    const recent = renderer.drawPolaroid(canvas, photo(), settings({ caption: 'Current caption' }))
    pendingAssets[0]()
    await recent
    pendingAssets[1]()
    await old
    const drawnText = contexts.flatMap((context) => context.fillText.mock.calls.map((call) => call[0]))
    expect(drawnText).toContain('Current caption')
    expect(drawnText).not.toContain('Old caption')
  })

  it('does not read disposed photos or alter the preview after an abort', async () => {
    deferAssets = true
    const canvas = document.createElement('canvas')
    const controller = new AbortController()
    const source = photo()
    const drawing = renderer.drawPolaroid(canvas, source, settings(), { signal: controller.signal })
    controller.abort()
    source.dispose()
    pendingAssets[0]()
    await drawing
    expect(canvas.width).toBe(300)
    expect(contexts).toHaveLength(0)
  })

  it('returns a clear export error when PNG encoding fails', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(null))
    await expect(renderer.exportPolaroid(photo(), settings())).rejects.toMatchObject({ code: 'export' })
  })
})

describe('photobooth layouts and independent crops', () => {
  const layouts: BoothLayout[] = ['strip', 'grid', 'single']

  it('defaults to a four-photo strip and retains the original single-photo dimensions', () => {
    expect(renderer.DEFAULT_BOOTH_SETTINGS.layout).toBe('strip')
    expect(renderer.getBoothLayout('strip')).toMatchObject({ width: 900, height: 2700 })
    expect(renderer.getBoothLayout('grid')).toMatchObject({ width: 1600, height: 1900 })
    expect(renderer.getBoothLayout('single')).toEqual({ width: 1200, height: 1500, photoRects: [{ ...renderer.PHOTO_RECT }] })
    expect(renderer.normalizeBoothSettings(boothSettings({ layout: 'invalid' as BoothLayout })).layout).toBe('strip')
    const changed = renderer.getBoothLayout('strip')
    changed.photoRects[0].x = -200
    expect(renderer.getBoothLayout('strip').photoRects[0].x).toBe(72)
  })

  it.each(layouts)('places distinct, non-overlapping photo slots inside the %s frame', (layout) => {
    const dimensions = renderer.getBoothLayout(layout)
    expect(dimensions.photoRects).toHaveLength(layout === 'single' ? 1 : 4)
    expect(new Set(dimensions.photoRects.map((rect) => `${rect.x},${rect.y}`)).size).toBe(dimensions.photoRects.length)
    dimensions.photoRects.forEach((rect, index) => {
      expect(rect.x).toBeGreaterThan(0)
      expect(rect.y).toBeGreaterThan(0)
      expect(rect.x + rect.width).toBeLessThan(dimensions.width)
      expect(rect.y + rect.height).toBeLessThan(dimensions.height - 200)
      expect(rect.width / rect.height).toBeCloseTo(layout === 'strip' ? 4 / 3 : 1)
      dimensions.photoRects.slice(index + 1).forEach((other) => {
        expect(rect.x + rect.width <= other.x || other.x + other.width <= rect.x || rect.y + rect.height <= other.y || other.y + other.height <= rect.y).toBe(true)
      })
    })
  })

  it.each([0, 90, 180, 270] as const)('keeps rectangular strip crops inside every rotated source at %i degrees', (rotation) => {
    const rect = renderer.getBoothLayout('strip').photoRects[0]
    for (const [width, height] of [[4000, 3000], [3000, 4000], [800, 800]]) {
      for (const zoom of [1, 1.35, 3]) {
        for (const positionX of [-1, 0, 1]) {
          for (const positionY of [-1, 0, 1]) {
            const geometry = renderer.getPhotoGeometry(width, height, { rotation, zoom, positionX, positionY }, rect)
            const sideways = rotation === 90 || rotation === 270
            expect(geometry.rotatedDrawWidth).toBeGreaterThanOrEqual(rect.width - 0.00001)
            expect(geometry.rotatedDrawHeight).toBeGreaterThanOrEqual(rect.height - 0.00001)
            expect(geometry.sourceCrop.x).toBeGreaterThanOrEqual(0)
            expect(geometry.sourceCrop.y).toBeGreaterThanOrEqual(0)
            expect(geometry.sourceCrop.x + geometry.sourceCrop.width).toBeLessThanOrEqual((sideways ? height : width) + 0.00001)
            expect(geometry.sourceCrop.y + geometry.sourceCrop.height).toBeLessThanOrEqual((sideways ? width : height) + 0.00001)
            expect(geometry.sourceCrop.width / geometry.sourceCrop.height).toBeCloseTo(4 / 3)
          }
        }
      }
    }
  })

  it('converts panning using the active rectangle and preserves the other slot crops', () => {
    const entries = boothPhotos()
    const before = entries.map((entry) => ({ ...entry.crop }))
    const rect = renderer.getBoothLayout('strip').photoRects[0]
    const result = renderer.boothPositionDelta(entries[0].photo, { ...entries[0].crop, zoom: 2 }, rect, 189, -141.75)
    expect(result).toEqual({ positionX: 0.5, positionY: -0.5 })
    expect(entries.map((entry) => entry.crop)).toEqual(before)
    expect(renderer.boothPositionDelta(entries[0].photo, entries[0].crop, rect, 1000, 1000)).toEqual({ positionX: 0, positionY: 0 })
    const rotated = { ...entries[0].crop, rotation: 90 as const }
    expect(renderer.boothPositionDelta(entries[0].photo, rotated, rect, 1000, 220.5)).toEqual({ positionX: 0, positionY: 1 })
  })

  it.each(layouts)('exports all required %s photos at the layout dimensions in slot order', async (layout) => {
    const entries = boothPhotos(layout === 'single' ? 1 : 4)
    entries.forEach((entry, index) => { entry.crop.rotation = [0, 90, 180, 270][index] as 0 | 90 | 180 | 270 })
    const dimensions = renderer.getBoothLayout(layout)
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      expect(this.width).toBe(dimensions.width)
      expect(this.height).toBe(dimensions.height)
      expect(type).toBe('image/png')
      callback(new Blob(['png-data'], { type: 'image/png' }))
    })
    const result = await renderer.exportPhotobooth(entries, boothSettings({ layout, finish: 'warm' }))
    expect(result.type).toBe('image/png')
    const photoContexts = contexts.filter((context) => context.rotate.mock.calls.length)
    expect(photoContexts).toHaveLength(entries.length)
    photoContexts.forEach((context, index) => {
      expect(context.drawImage.mock.calls[0][0]).toBe(entries[index].photo.source)
      expect(context.rotate).toHaveBeenCalledWith(entries[index].crop.rotation * Math.PI / 180)
      expect(context.getImageData).toHaveBeenCalledWith(0, 0, dimensions.photoRects[index].width, dimensions.photoRects[index].height)
    })
    dimensions.photoRects.forEach((rect) => expect(contexts[0].drawImage.mock.calls.some((call) => call.length === 3 && call[1] === rect.x && call[2] === rect.y)).toBe(true))
    expect(entries.every((entry) => vi.mocked(entry.photo.dispose).mock.calls.length === 0)).toBe(true)
  })

  it.each(layouts)('keeps captions, the plane divider, names, date and footer clearly separated in every %s frame', async (layout) => {
    const dimensions = renderer.getBoothLayout(layout)
    const photoBottom = Math.max(...dimensions.photoRects.map((rect) => rect.y + rect.height))
    for (const frame of ['ivory', 'airmail', 'clouds'] as const) {
      for (const celebration of ['solemnisation', 'reception'] as const) {
        for (const caption of ['', '   \n ', 'Forever together', 'One beautiful day, so many memories, our favourite people']) {
          const contextIndex = contexts.length
          await renderer.drawPhotobooth(document.createElement('canvas'), boothPhotos(), boothSettings({
            layout, frame, celebration, caption,
          }))
          const output = contexts[contextIndex]
          const [borderX, borderY, borderWidth, borderHeight] = output.strokeRect.mock.calls[0]
          const bottomRule = borderY + borderHeight
          expect(output.textRuns.length).toBeGreaterThanOrEqual(6)
          output.textRuns.forEach((run) => {
            // Include conservative ascender/descender extents, not only text baselines.
            expect(run.y - run.fontSize).toBeGreaterThan(photoBottom)
            expect(run.y + run.fontSize * 0.3).toBeLessThan(bottomRule - 12)
            expect(run.x - run.maxWidth / 2).toBeGreaterThan(borderX)
            expect(run.x + run.maxWidth / 2).toBeLessThan(borderX + borderWidth)
          })
          const names = output.textRuns.filter(run => ['Aleem', '&', 'Nurulain'].includes(run.text))
          expect(names).toHaveLength(3)
          const date = output.textRuns.find((run) => run.text.includes('AUGUST 2027'))!
          const detail = output.textRuns.find(run => run.text === 'SINGAPORE  /  FOREVER')!
          const kicker = output.textRuns.find(run => run.text === 'OUR WEDDING')
          expect(date.fontSize).toBe(layout === 'strip' ? 28 : 34)
          expect(date.fillStyle).toBe('#081b31')
          expect(date.text).toBe(celebration === 'solemnisation' ? '21 AUGUST 2027' : '22 AUGUST 2027')
          expect(Math.max(...names.map(run => run.y + run.fontSize * 0.25)) + 4).toBeLessThan(date.y - date.fontSize)
          expect(date.y + date.fontSize * 0.25 + 4).toBeLessThan(detail.y - detail.fontSize)
          const captions = output.textRuns.filter(run => !names.includes(run) && run !== date && run !== detail && run !== kicker)
          expect(captions.length).toBeLessThanOrEqual(2)
          expect(captions.map(run => run.text).join(' ')).toBe(caption.trim())
          expect(Boolean(kicker)).toBe(!caption.trim())

          const marks = output.strokeRuns.filter(run => run.points.length && run.points.every(point => point.y > photoBottom))
          expect(marks).toHaveLength(2)
          const divider = marks.find(run => run.points.every(point => point.y === run.points[0].y))!
          const plane = marks.find(run => run !== divider)!
          expect(divider.points.filter(point => point.kind === 'move')).toHaveLength(2)
          expect(divider.color).toBe('#b79b65')
          expect(plane.color).toBe(divider.color)
          expect(plane.points.length).toBeGreaterThanOrEqual(5)
          const planeTop = Math.min(...plane.points.map(point => point.y))
          const planeBottom = Math.max(...plane.points.map(point => point.y))
          expect(planeTop).toBeLessThan(divider.points[0].y)
          expect(planeBottom).toBeGreaterThan(divider.points[0].y)
          expect(planeBottom + 4).toBeLessThan(Math.min(...names.map(run => run.y - run.fontSize * 0.8)))
          const aboveDivider = kicker ? [kicker] : captions
          expect(Math.max(...aboveDivider.map(run => run.y + run.fontSize * 0.25)) + 4).toBeLessThan(planeTop)
        }
      }
    }
  })

  it('allows incomplete previews but rejects incomplete exports before reading any sources', async () => {
    const entries = boothPhotos()
    const incomplete = [entries[0], null, entries[2]]
    const canvas = document.createElement('canvas')
    await renderer.drawPhotobooth(canvas, incomplete, boothSettings())
    expect(contexts.filter((context) => context.rotate.mock.calls.length)).toHaveLength(2)
    expect(canvas.width).toBe(900)
    await expect(renderer.exportPhotobooth(incomplete, boothSettings())).rejects.toMatchObject({ code: 'incomplete' })
    await expect(renderer.exportPhotobooth([], boothSettings({ layout: 'single' }))).rejects.toMatchObject({ code: 'incomplete' })
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled()
  })

  it.each(layouts)('gives empty and whitespace captions larger names without reserving caption lines in %s', async layout => {
    for (const caption of ['', '   \n  ']) {
      const contextIndex = contexts.length
      await renderer.drawPhotobooth(document.createElement('canvas'), boothPhotos(), boothSettings({ layout, caption }))
      const output = contexts[contextIndex]
      expect(output.textRuns.map(run => run.text)).toEqual(['OUR WEDDING', 'Aleem', 'Nurulain', '&', '21 AUGUST 2027', 'SINGAPORE  /  FOREVER'])
      expect(output.textRuns.find(run => run.text === 'Aleem')?.fontSize).toBe(layout === 'strip' ? 82 : 96)
      const monogram = output.drawImage.mock.calls.find(call => (call[0] as { src?: string }).src?.endsWith('/monogram.png'))!
      expect(monogram).toBeDefined()
      expect(monogram[1] + monogram[3] / 2).toBeGreaterThan(renderer.getBoothLayout(layout).width / 2)
      expect(output.globalAlpha).toBeLessThan(0.1)
    }
    const contextIndex = contexts.length
    await renderer.drawPhotobooth(document.createElement('canvas'), boothPhotos(), boothSettings({ layout, caption: 'Forever together' }))
    expect(contexts[contextIndex].textRuns.find(run => run.text === 'Aleem')?.fontSize).toBe(layout === 'strip' ? 48 : 60)
  })

  it.each(layouts)('centres the %s names as a group around a smaller italic gold ampersand', async layout => {
    for (const caption of ['', 'A day to remember']) {
      const contextIndex = contexts.length
      await renderer.drawPhotobooth(document.createElement('canvas'), boothPhotos(), boothSettings({ layout, caption }))
      const output = contexts[contextIndex]
      const first = output.textRuns.find(run => run.text === 'Aleem')!
      const last = output.textRuns.find(run => run.text === 'Nurulain')!
      const ampersand = output.textRuns.find(run => run.text === '&')!

      expect(first.font).toMatch(/^400 /)
      expect(last.font).toBe(first.font)
      expect(first.fillStyle).toBe('#081b31')
      expect(last.fillStyle).toBe(first.fillStyle)
      expect(ampersand.font).toMatch(/^italic 400 /)
      expect(ampersand.fillStyle).toBe('#a3824d')
      expect(ampersand.fontSize).toBeCloseTo(first.fontSize * 0.72)
      expect(ampersand.y).toBe(first.y)
      expect(last.y).toBe(first.y)
      expect(first.x + first.maxWidth / 2).toBeLessThan(ampersand.x - ampersand.maxWidth / 2)
      expect(ampersand.x + ampersand.maxWidth / 2).toBeLessThan(last.x - last.maxWidth / 2)
      const groupLeft = first.x - first.maxWidth / 2
      const groupRight = last.x + last.maxWidth / 2
      expect((groupLeft + groupRight) / 2).toBeCloseTo(renderer.getBoothLayout(layout).width / 2)
    }
  })

  it('allows a date-free draft but rejects null and legacy combined dates before exporting', async () => {
    expect(renderer.DEFAULT_BOOTH_SETTINGS.celebration).toBeNull()
    await renderer.drawPhotobooth(document.createElement('canvas'), boothPhotos(), boothSettings({ celebration: null }))
    expect(contexts[0].textRuns.some(run => run.text.includes('AUGUST'))).toBe(false)
    for (const celebration of [null, 'both'] as const) {
      await expect(renderer.exportPhotobooth(boothPhotos(), boothSettings({ celebration } as unknown as Partial<BoothSettings>))).rejects.toMatchObject({ code: 'date' })
    }
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled()
  })

  it('uses the dedicated narrow cloud asset for strips and a neutral fallback if that asset fails', async () => {
    failAssets = true
    await renderer.drawPhotobooth(document.createElement('canvas'), boothPhotos(), boothSettings({ frame: 'clouds' }))
    expect(imageSources.map(source => new URL(source).pathname)).toEqual(['/monogram.png', '/photobooth-strip-clouds.png'])
    expect(contexts[0].fillRect).toHaveBeenCalledWith(0, 0, 900, 2700)
    expect(contexts[0].drawImage.mock.calls.some(call => call.length === 9)).toBe(false)
    expect(contexts[0].textRuns.map(run => run.text)).toEqual(['OUR WEDDING', 'Aleem', 'Nurulain', '&', '21 AUGUST 2027', 'SINGAPORE  /  FOREVER'])
  })

  it('snapshots slot order and crops while optional assets load', async () => {
    deferAssets = true
    const entries = boothPhotos()
    const first = entries[0].photo
    const drawing = renderer.drawPhotobooth(document.createElement('canvas'), entries, boothSettings())
    entries[0].crop.rotation = 180
    entries.reverse()
    pendingAssets[0]()
    await drawing
    const drawn = contexts.filter((context) => context.rotate.mock.calls.length)
    expect(drawn[0].drawImage.mock.calls[0][0]).toBe(first.source)
    expect(drawn[0].rotate).toHaveBeenCalledWith(0)
  })

  it('never lets a delayed four-photo layout overwrite a newer single preview', async () => {
    deferAssets = true
    const canvas = document.createElement('canvas')
    const old = renderer.drawPhotobooth(canvas, boothPhotos(), boothSettings({ frame: 'clouds' }))
    const recent = renderer.drawPolaroid(canvas, photo(), settings({ caption: 'Current single' }))
    pendingAssets[0]()
    await recent
    pendingAssets[1]()
    await old
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(1500)
    expect(contexts.filter((context) => context.rotate.mock.calls.length)).toHaveLength(1)
    expect(contexts[0].textRuns.some((run) => run.text === 'Current single')).toBe(true)
  })
})
