import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedPhoto, PolaroidSettings } from './types'

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

function makeContext() {
  return {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
    imageSmoothingEnabled: false, imageSmoothingQuality: '',
    drawImage: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    translate: vi.fn(), rotate: vi.fn(), putImageData: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([100, 150, 200, 255]) })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillText: vi.fn(),
    measureText(text: string) { return { width: Array.from(text).length * Number(this.font.match(/(\d+)px/)?.[1] ?? 20) * 0.55 } },
  }
}
type MockContext = ReturnType<typeof makeContext>

function bitmap(width = 4000, height = 3000) {
  return { width, height, close: vi.fn() }
}

function settings(values: Partial<PolaroidSettings> = {}): PolaroidSettings {
  return { ...renderer.DEFAULT_POLAROID_SETTINGS, ...values }
}

function photo(width = 4000, height = 3000): LoadedPhoto {
  return { source: document.createElement('canvas'), width, height, dispose: vi.fn() }
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
    const decoded = bitmap(3000, 4000)
    bitmapDecode.mockResolvedValue(decoded)
    const file = new File(['photo'], 'phone.JPEG')
    const loaded = await renderer.loadPolaroidPhoto(file)
    expect(bitmapDecode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
    expect(loaded).toMatchObject({ source: decoded, width: 3000, height: 4000 })
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
    expect(loaded.width).toBe(4000)
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

  it('downscales huge images to a bounded raster, closing the original decode', async () => {
    const decoded = bitmap(6000, 4000)
    bitmapDecode.mockResolvedValue(decoded)
    const loaded = await renderer.loadPolaroidPhoto(new File(['photo'], 'large.jpg', { type: 'image/jpeg' }))
    expect(loaded).toMatchObject({ width: 4096, height: 2731 })
    expect(decoded.close).toHaveBeenCalledTimes(1)
    expect(contexts[0].drawImage).toHaveBeenCalledWith(decoded, 0, 0, 4096, 2731)
    loaded.dispose()
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
  it('draws the full-resolution rotated photo and keeps caption above the monogram', async () => {
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
    expect(output.fillText).toHaveBeenCalledWith('Aleem & Nurulain', 600, 1421, 760)
    expect(output.font).toContain('monospace')
    expect(document.fonts.load).toHaveBeenCalledWith('400 48px "Instrument Serif"')
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
    expect(contexts.some((context) => context.fillText.mock.calls.some((call) => call[0] === '21 AUGUST 2027 · NIKAH & BRIDE’S RECEPTION'))).toBe(true)
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
    expect(imageSources.map((source) => new URL(source).pathname)).toEqual(['/monogram.png', '/polaroid-clouds.png', '/journal-sky.webp'])
    expect(imageSources.every((source) => new URL(source).origin === window.location.origin)).toBe(true)
    expect(contexts[0].fillText).toHaveBeenCalledWith('Aleem & Nurulain', 600, 1421, 760)
  })

  it('caches decorative assets between previews and export', async () => {
    const canvas = document.createElement('canvas')
    await renderer.drawPolaroid(canvas, photo(), settings({ frame: 'clouds' }))
    await renderer.drawPolaroid(canvas, photo(), settings({ frame: 'clouds', zoom: 2 }))
    await renderer.exportPolaroid(photo(), settings({ frame: 'clouds' }))
    expect(imageSources).toHaveLength(2)
    expect(document.fonts.load).toHaveBeenCalledTimes(1)
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
