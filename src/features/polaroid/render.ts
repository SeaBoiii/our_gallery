import type { BoothLayout, BoothLayoutGeometry, BoothPhoto, BoothSettings, LoadedPhoto, PhotoCrop, PhotoGeometry, PhotoRect, PolaroidSettings } from './types'

export const POLAROID_WIDTH = 1200
export const POLAROID_HEIGHT = 1500
export const PHOTO_RECT = Object.freeze({ x: 72, y: 72, width: 1056, height: 1056 })
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024
// A four-photo replacement can briefly retain eight sources; bound retained rasters
// while keeping enough source detail for 3× cropping in the strip and grid layouts.
export const MAX_PHOTO_DIMENSION = 2400
export const MAX_CAPTION_LENGTH = 60
export const DEFAULT_POLAROID_SETTINGS: PolaroidSettings = {
  frame: 'ivory', caption: '', celebration: null, finish: 'original',
  zoom: 1, positionX: 0, positionY: 0, rotation: 0,
}
export const DEFAULT_PHOTO_CROP: PhotoCrop = { zoom: 1, positionX: 0, positionY: 0, rotation: 0 }
export const DEFAULT_BOOTH_SETTINGS: BoothSettings = {
  layout: 'strip', frame: 'ivory', caption: '', celebration: null, finish: 'original',
}

export function getBoothLayout(layout: BoothLayout): BoothLayoutGeometry {
  if (layout === 'single') return { width: POLAROID_WIDTH, height: POLAROID_HEIGHT, photoRects: [{ ...PHOTO_RECT }] }
  if (layout === 'grid') return {
    width: 1600, height: 1900,
    photoRects: [{ x: 80, y: 80, width: 700, height: 700 }, { x: 820, y: 80, width: 700, height: 700 },
      { x: 80, y: 820, width: 700, height: 700 }, { x: 820, y: 820, width: 700, height: 700 }],
  }
  return {
    width: 900, height: 2700,
    photoRects: [60, 651, 1242, 1833].map((y) => ({ x: 72, y, width: 756, height: 567 })),
  }
}

const INK = '#081b31'
const GOLD = '#b79b65'
const PAPER = '#f7f2e8'
const MONO_FONT = 'Consolas, "Liberation Mono", monospace'
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const extensionTypes: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback

export class PolaroidError extends Error {
  readonly code: 'format' | 'size' | 'decode' | 'canvas' | 'export' | 'incomplete' | 'date'

  constructor(code: PolaroidError['code'], message: string) {
    super(message)
    this.name = 'PolaroidError'
    this.code = code
  }
}

export function normalizePhotoCrop(crop: PhotoCrop): PhotoCrop {
  return {
    zoom: clamp(finite(crop.zoom, 1), 1, 3),
    positionX: clamp(finite(crop.positionX, 0), -1, 1),
    positionY: clamp(finite(crop.positionY, 0), -1, 1),
    rotation: [0, 90, 180, 270].includes(crop.rotation) ? crop.rotation : 0,
  }
}

export function normalizeBoothSettings(settings: BoothSettings): BoothSettings {
  return {
    layout: ['strip', 'grid', 'single'].includes(settings.layout) ? settings.layout : 'strip',
    frame: ['ivory', 'airmail', 'clouds'].includes(settings.frame) ? settings.frame : 'ivory',
    caption: Array.from(String(settings.caption ?? '').replace(/\s+/gu, ' ').trim()).slice(0, MAX_CAPTION_LENGTH).join(''),
    celebration: settings.celebration === 'solemnisation' || settings.celebration === 'reception' ? settings.celebration : null,
    finish: ['original', 'warm', 'mono'].includes(settings.finish) ? settings.finish : 'original',
  }
}

export function normalizeSettings(settings: PolaroidSettings): PolaroidSettings {
  const { frame, caption, celebration, finish } = normalizeBoothSettings({ ...settings, layout: 'single' })
  return { frame, caption, celebration, finish, ...normalizePhotoCrop(settings) }
}

/** Center-cover geometry; panning always remains inside the rotated image. */
export function getPhotoGeometry(width: number, height: number, settings: PhotoCrop, rect: PhotoRect = PHOTO_RECT): PhotoGeometry {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new PolaroidError('decode', 'This photo has invalid dimensions. Please choose another image.')
  }
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
    throw new PolaroidError('canvas', 'The selected photo layout has invalid dimensions.')
  }
  const normalized = normalizePhotoCrop(settings)
  const sideways = normalized.rotation === 90 || normalized.rotation === 270
  const rotatedWidth = sideways ? height : width
  const rotatedHeight = sideways ? width : height
  const scale = Math.max(rect.width / rotatedWidth, rect.height / rotatedHeight) * normalized.zoom
  const rotatedDrawWidth = rotatedWidth * scale
  const rotatedDrawHeight = rotatedHeight * scale
  const panLimitX = Math.max(0, (rotatedDrawWidth - rect.width) / 2)
  const panLimitY = Math.max(0, (rotatedDrawHeight - rect.height) / 2)
  const cropWidth = Math.min(rotatedWidth, rect.width / scale)
  const cropHeight = Math.min(rotatedHeight, rect.height / scale)
  return {
    scale,
    imageDrawWidth: width * scale,
    imageDrawHeight: height * scale,
    rotatedDrawWidth,
    rotatedDrawHeight,
    panLimitX,
    panLimitY,
    offsetX: normalized.positionX * panLimitX,
    offsetY: normalized.positionY * panLimitY,
    sourceCrop: {
      x: (rotatedWidth - cropWidth) * (1 - normalized.positionX) / 2,
      y: (rotatedHeight - cropHeight) * (1 - normalized.positionY) / 2,
      width: cropWidth,
      height: cropHeight,
    },
  }
}

/** Positive deltas move the photograph right/down, measured in the 1200×1500 output. */
export function positionDelta(photo: LoadedPhoto, settings: PolaroidSettings, dx: number, dy: number) {
  return boothPositionDelta(photo, settings, PHOTO_RECT, dx, dy)
}

/** Panning is independent per slot, in output-canvas pixels, after rotation. */
export function boothPositionDelta(photo: LoadedPhoto, crop: PhotoCrop, rect: PhotoRect, dx: number, dy: number) {
  const normalized = normalizePhotoCrop(crop)
  const geometry = getPhotoGeometry(photo.width, photo.height, normalized, rect)
  return {
    positionX: geometry.panLimitX > 0.0001 ? clamp(normalized.positionX + finite(dx, 0) / geometry.panLimitX, -1, 1) : 0,
    positionY: geometry.panLimitY > 0.0001 ? clamp(normalized.positionY + finite(dy, 0) / geometry.panLimitY, -1, 1) : 0,
  }
}

function contextFor(canvas: HTMLCanvasElement, readFrequently = false) {
  const context = canvas.getContext('2d', { willReadFrequently: readFrequently })
  if (!context) throw new PolaroidError('canvas', 'Your browser could not open the photo editor. Please try another browser.')
  return context
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function decodeWithImage(blob: Blob): Promise<LoadedPhoto> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(blob)
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      image.onload = null
      image.onerror = null
      image.src = ''
      URL.revokeObjectURL(url)
    }
    const timer = window.setTimeout(() => { dispose(); reject(new Error('Image decode timed out.')) }, 8000)
    image.onload = () => {
      window.clearTimeout(timer)
      if (!image.naturalWidth || !image.naturalHeight) { dispose(); reject(new Error('Empty image.')); return }
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, dispose })
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      dispose()
      reject(new Error('Image decode failed.'))
    }
    image.src = url
  })
}

async function decodeNative(blob: Blob): Promise<LoadedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      // EXIF orientation is applied by the decoder, before our explicit quarter turns.
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      if (!bitmap.width || !bitmap.height) { bitmap.close(); throw new Error('Empty image.') }
      let disposed = false
      return {
        source: bitmap, width: bitmap.width, height: bitmap.height,
        dispose: () => { if (!disposed) { disposed = true; bitmap.close() } },
      }
    } catch { /* Safari may support an image through its native <img> decoder. */ }
  }
  return decodeWithImage(blob)
}

export async function loadPolaroidPhoto(file: File): Promise<LoadedPhoto> {
  const type = file.type.trim().toLowerCase() || extensionTypes[file.name.split('.').pop()?.toLowerCase() ?? '']
  if (!allowedTypes.has(type)) throw new PolaroidError('format', 'Please choose a JPEG, PNG, WebP or HEIC photo.')
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) throw new PolaroidError('size', 'Please choose a photo smaller than 25 MB.')
  let photo: LoadedPhoto
  try {
    try {
      photo = await decodeNative(file)
    } catch (error) {
      if (type !== 'image/heic' && type !== 'image/heif') throw error
      const { default: heic2any } = await import('heic2any')
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 })
      const first = Array.isArray(converted) ? converted[0] : converted
      if (!first) throw new Error('HEIC contains no image.')
      photo = await decodeNative(first)
    }
  } catch {
    throw new PolaroidError('decode', 'This photo could not be opened. Please try a JPEG, PNG or another photo.')
  }
  if (Math.max(photo.width, photo.height) <= MAX_PHOTO_DIMENSION) return photo
  const scale = MAX_PHOTO_DIMENSION / Math.max(photo.width, photo.height)
  const canvas = makeCanvas(Math.max(1, Math.round(photo.width * scale)), Math.max(1, Math.round(photo.height * scale)))
  try {
    const context = contextFor(canvas)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(photo.source, 0, 0, canvas.width, canvas.height)
  } catch {
    canvas.width = 0
    canvas.height = 0
    throw new PolaroidError('decode', 'This photo is too large to open on this device. Please choose a smaller photo.')
  } finally {
    photo.dispose()
  }
  const width = canvas.width
  const height = canvas.height
  return { source: canvas, width, height, dispose: () => { canvas.width = 0; canvas.height = 0 } }
}

/** Portable pixel treatment: Safari and Chromium export the same finish without CSS filters. */
export function applyPhotoFinish(pixels: Uint8ClampedArray, finish: PolaroidSettings['finish']) {
  if (finish === 'original') return
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    if (finish === 'mono') {
      const light = red * 0.2126 + green * 0.7152 + blue * 0.0722
      pixels[index] = light
      pixels[index + 1] = light
      pixels[index + 2] = light
    } else {
      const light = red * 0.2126 + green * 0.7152 + blue * 0.0722
      pixels[index] = red * 0.88 + light * 0.12 + 9
      pixels[index + 1] = green * 0.9 + light * 0.1 + 3
      pixels[index + 2] = blue * 0.85 + light * 0.15 - 7
    }
  }
}

const assetCache = new Map<string, Promise<HTMLImageElement | null>>()
function loadAsset(path: '/monogram.png' | '/polaroid-clouds.png' | '/photobooth-strip-clouds.png') {
  const cached = assetCache.get(path)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image()
    const finish = (loaded: boolean) => {
      window.clearTimeout(timer)
      image.onload = null
      image.onerror = null
      if (!loaded) image.src = ''
      resolve(loaded ? image : null)
    }
    const timer = window.setTimeout(() => finish(false), 4000)
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0)
    image.onerror = () => finish(false)
    // Only these fixed, same-origin decorative assets are requested. Local photos never leave the browser.
    image.src = new URL(path, window.location.origin).href
  })
  assetCache.set(path, promise)
  return promise
}

let fontPromise: Promise<string> | undefined
function loadSerifFont() {
  fontPromise ??= new Promise<string>((resolve) => {
    const fallback = 'Georgia, "Times New Roman", serif'
    if (!document.fonts?.load) { resolve(fallback); return }
    const timer = window.setTimeout(() => resolve(fallback), 4000)
    document.fonts.load('400 48px "Instrument Serif"').then((fonts) => {
      window.clearTimeout(timer)
      resolve(fonts.length ? '"Instrument Serif", Georgia, serif' : fallback)
    }, () => { window.clearTimeout(timer); resolve(fallback) })
  })
  return fontPromise
}

/** Fits an entire caption into one or two balanced lines, including unbroken words. */
export function fitCaptionLines(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  if (!text) return []
  if (measure(text) <= maxWidth) return [text]
  const letters = Array.from(text)
  const candidates: { lines: string[]; score: number }[] = []
  for (let index = 1; index < letters.length; index += 1) {
    const first = letters.slice(0, index).join('').trim()
    const second = letters.slice(index).join('').trim()
    const firstWidth = measure(first)
    const secondWidth = measure(second)
    if (!first || !second || firstWidth > maxWidth || secondWidth > maxWidth) continue
    const wordBoundary = letters[index - 1] === ' ' || letters[index] === ' '
    candidates.push({ lines: [first, second], score: Math.abs(firstWidth - secondWidth) + (wordBoundary ? 0 : maxWidth) })
  }
  candidates.sort((first, second) => first.score - second.score)
  return candidates[0]?.lines ?? []
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  context.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2,
    sourceWidth, sourceHeight, x, y, width, height)
}

function footerStart(layout: BoothLayoutGeometry) {
  return Math.max(...layout.photoRects.map((rect) => rect.y + rect.height))
}

function drawFrame(context: CanvasRenderingContext2D, frame: BoothSettings['frame'], clouds: HTMLImageElement | null, layout: BoothLayoutGeometry) {
  const { width, height } = layout
  const unit = Math.min(1, width / POLAROID_WIDTH)
  const footerTop = footerStart(layout)
  context.fillStyle = PAPER
  context.fillRect(0, 0, width, height)
  if (frame === 'clouds' && clouds) {
    drawCover(context, clouds, 0, 0, width, height)
    // Keep the caption legible without covering the decorative outer margins.
    const wash = context.createLinearGradient(0, footerTop, 0, height)
    wash.addColorStop(0, '#f7f2e820')
    wash.addColorStop(0.45, '#f7f2e8b8')
    wash.addColorStop(1, '#f7f2e870')
    context.fillStyle = wash
    context.fillRect(60 * unit, footerTop, width - 120 * unit, height - footerTop)
  }
  if (frame === 'airmail') {
    context.save()
    context.beginPath()
    context.rect(18 * unit, 18 * unit, width - 36 * unit, height - 36 * unit)
    context.rect(37 * unit, 37 * unit, width - 74 * unit, height - 74 * unit)
    context.clip('evenodd')
    context.lineWidth = 25 * unit
    for (let index = -Math.ceil(height / (60 * unit)); index < Math.ceil(width / (60 * unit)); index += 1) {
      context.strokeStyle = index % 2 === 0 ? INK : GOLD
      context.beginPath()
      context.moveTo(index * 60 * unit, 0)
      context.lineTo(index * 60 * unit + height, height)
      context.stroke()
    }
    context.restore()
  }
  context.strokeStyle = '#b79b6570'
  context.lineWidth = 1
  const inset = 48 * unit + 0.5
  context.strokeRect(inset, inset, width - inset * 2, height - inset * 2)
}

function drawPhoto(context: CanvasRenderingContext2D, entry: BoothPhoto | null, finish: BoothSettings['finish'], rect: PhotoRect) {
  const { x, y, width, height } = rect
  context.fillStyle = '#e9e5dd'
  context.fillRect(x, y, width, height)
  if (entry) {
    const { photo } = entry
    const crop = normalizePhotoCrop(entry.crop)
    const layer = makeCanvas(width, height)
    try {
      const photoContext = contextFor(layer, finish !== 'original')
      const geometry = getPhotoGeometry(photo.width, photo.height, crop, rect)
      photoContext.imageSmoothingEnabled = true
      photoContext.imageSmoothingQuality = 'high'
      photoContext.translate(width / 2 + geometry.offsetX, height / 2 + geometry.offsetY)
      photoContext.rotate(crop.rotation * Math.PI / 180)
      photoContext.drawImage(photo.source, -geometry.imageDrawWidth / 2, -geometry.imageDrawHeight / 2,
        geometry.imageDrawWidth, geometry.imageDrawHeight)
      if (finish !== 'original') {
        const pixels = photoContext.getImageData(0, 0, width, height)
        applyPhotoFinish(pixels.data, finish)
        photoContext.putImageData(pixels, 0, 0)
      }
      context.drawImage(layer, x, y)
    } finally {
      layer.width = 0
      layer.height = 0
    }
  }
  context.strokeStyle = '#081b3118'
  context.lineWidth = 1
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
}

function drawFooter(context: CanvasRenderingContext2D, settings: BoothSettings, monogram: HTMLImageElement | null, serif: string, layout: BoothLayoutGeometry) {
  const center = layout.width / 2
  const unit = Math.min(1, layout.width / POLAROID_WIDTH)
  const top = footerStart(layout)
  const lowerRule = layout.height - 62 * unit
  const footerHeight = lowerRule - top
  const hasCaption = Boolean(settings.caption.trim())
  // A quiet, offset monogram gives the footer the feel of a printed wedding ticket.
  if (monogram) {
    const height = footerHeight * 0.6
    const width = height * monogram.naturalWidth / monogram.naturalHeight
    context.save()
    context.globalAlpha = 0.065
    context.drawImage(monogram, layout.width * 0.72 - width / 2, top + footerHeight * 0.2, width, height)
    context.restore()
  }
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  context.fillStyle = INK
  const captionWidth = Math.round(layout.width * 0.82)
  let captionSize = 52 * unit
  let lines: string[] = []
  while (captionSize >= 20 * unit) {
    context.font = `400 ${captionSize}px ${serif}`
    lines = fitCaptionLines(settings.caption, captionWidth, (text) => context.measureText(text).width)
    if (lines.length || !settings.caption) break
    captionSize -= 2 * unit
  }
  if (!lines.length && hasCaption) lines = [settings.caption]
  // maxWidth remains a final guard for unusual font metrics or unsupported glyphs.
  lines.forEach((line, index) => context.fillText(line, center, top + (lines.length === 1 ? 72 : 55 + index * 53) * unit, captionWidth))
  context.strokeStyle = GOLD
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(layout.width * 0.15, lowerRule)
  context.lineTo(layout.width * 0.85, lowerRule)
  context.stroke()
  const nameSize = settings.layout === 'strip' ? (hasCaption ? 48 : 82) : (hasCaption ? 60 : 96)
  context.font = `400 ${nameSize}px ${serif}`
  context.fillText('Aleem & Nurulain', center, top + footerHeight * (hasCaption ? 0.65 : 0.57), layout.width * 0.84)
  const labels = {
    solemnisation: '21 AUGUST 2027',
    reception: '22 AUGUST 2027',
  }
  context.font = `400 ${settings.layout === 'strip' ? 18 : 22}px ${MONO_FONT}`
  context.fillStyle = '#5b6672'
  // The date's baseline and descenders stay above the inner rule in every layout.
  if (settings.celebration) context.fillText(labels[settings.celebration], center, lowerRule - 25 * unit, layout.width * 0.8)
}

const renderVersions = new WeakMap<HTMLCanvasElement, number>()

/** Preview and export share this renderer. Superseded/aborted draws never overwrite the canvas. */
export async function drawPhotobooth(
  canvas: HTMLCanvasElement,
  photos: readonly (BoothPhoto | null)[],
  settings: BoothSettings,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const version = (renderVersions.get(canvas) ?? 0) + 1
  renderVersions.set(canvas, version)
  const normalized = normalizeBoothSettings(settings)
  const layout = getBoothLayout(normalized.layout)
  // Snapshot slot order/crops before awaiting assets; caller-owned settings stay mutable.
  const entries = layout.photoRects.map((_, index) => photos[index] ? { photo: photos[index].photo, crop: normalizePhotoCrop(photos[index].crop) } : null)
  const current = () => !options.signal?.aborted && renderVersions.get(canvas) === version
  if (!current()) return
  const [monogram, serif, clouds] = await Promise.all([
    loadAsset('/monogram.png'),
    loadSerifFont(),
    normalized.frame === 'clouds' ? loadAsset(normalized.layout === 'strip' ? '/photobooth-strip-clouds.png' : '/polaroid-clouds.png') : null,
  ])
  if (!current()) return
  const output = makeCanvas(layout.width, layout.height)
  try {
    const context = contextFor(output)
    drawFrame(context, normalized.frame, clouds, layout)
    layout.photoRects.forEach((rect, index) => drawPhoto(context, entries[index], normalized.finish, rect))
    drawFooter(context, normalized, monogram, serif, layout)
    if (!current()) return
    canvas.width = layout.width
    canvas.height = layout.height
    contextFor(canvas).drawImage(output, 0, 0)
  } finally {
    output.width = 0
    output.height = 0
  }
}

export async function exportPhotobooth(photos: readonly (BoothPhoto | null)[], settings: BoothSettings): Promise<Blob> {
  const normalized = normalizeBoothSettings(settings)
  const layout = getBoothLayout(normalized.layout)
  if (layout.photoRects.some((_, index) => !photos[index]?.photo)) {
    throw new PolaroidError('incomplete', 'Please add a photo to every space before saving your keepsake.')
  }
  if (!normalized.celebration) throw new PolaroidError('date', 'Please choose a wedding date before saving your keepsake.')
  const canvas = makeCanvas(layout.width, layout.height)
  try {
    await drawPhotobooth(canvas, photos, normalized)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new PolaroidError('export', 'The photo could not be saved. Please try again.'))
      }, 'image/png')
    })
  } catch (error) {
    if (error instanceof PolaroidError) throw error
    throw new PolaroidError('export', 'The photo could not be saved. Please try again.')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** Compatibility wrappers keep the original single-photo API on the shared renderer. */
export function drawPolaroid(canvas: HTMLCanvasElement, photo: LoadedPhoto | null, settings: PolaroidSettings, options: { signal?: AbortSignal } = {}) {
  return drawPhotobooth(canvas, [photo ? { photo, crop: normalizePhotoCrop(settings) } : null], { ...settings, layout: 'single' }, options)
}

export function exportPolaroid(photo: LoadedPhoto, settings: PolaroidSettings): Promise<Blob> {
  return exportPhotobooth([{ photo, crop: normalizePhotoCrop(settings) }], { ...settings, layout: 'single' })
}
