import { MAX_FILES_PER_BATCH, MAX_IMAGE_SIZE, MAX_VIDEO_SIZE } from '../config'
import type { MediaType, UploadVariantIntent } from '../../shared/contracts'

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm'])
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

export type FileValidation = { valid: true; mediaType: MediaType } | {
  valid: false
  reason: 'unsupported' | 'image-too-large' | 'video-too-large'
  message: string
}

const fileExtension = (file: File) => file.name.split('.').pop()?.toLowerCase() ?? ''

/** Browsers may leave File.type empty for HEIC/HEIF and other camera files. */
export function getUploadMimeType(file: File) {
  return file.type.trim().toLowerCase() || MIME_BY_EXTENSION[fileExtension(file)] || ''
}

export function validateFile(file: File): FileValidation {
  const extension = fileExtension(file)
  const mimeType = getUploadMimeType(file)
  const isImage = IMAGE_MIMES.has(mimeType) && IMAGE_EXTENSIONS.has(extension)
  const isVideo = VIDEO_MIMES.has(mimeType) && VIDEO_EXTENSIONS.has(extension)
  if (!isImage && !isVideo) return { valid: false, reason: 'unsupported', message: `${file.name}: This file format isn't supported yet.` }
  if (isImage && file.size > MAX_IMAGE_SIZE) return { valid: false, reason: 'image-too-large', message: `${file.name}: This photo is larger than the 25 MB upload limit.` }
  if (isVideo && file.size > MAX_VIDEO_SIZE) return { valid: false, reason: 'video-too-large', message: `${file.name}: This video is larger than the 250 MB upload limit.` }
  return { valid: true, mediaType: isImage ? 'photo' : 'video' }
}

export function validateBatch(files: File[]) {
  if (files.length > MAX_FILES_PER_BATCH) return [`You can add up to ${MAX_FILES_PER_BATCH} files in one check-in.`]
  return files.flatMap((file) => {
    const result = validateFile(file)
    return result.valid ? [] : [result.message]
  })
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`
}

export async function fingerprintFile(file: File): Promise<string> {
  let payload: ArrayBuffer | Uint8Array<ArrayBuffer>
  if (file.size <= 32 * 1024 * 1024) {
    payload = await file.arrayBuffer()
  } else {
    const encoder = new TextEncoder()
    const metadata = encoder.encode(`${getUploadMimeType(file)}|${file.size}`)
    const sampleSize = 1024 * 1024
    const first = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer())
    const last = new Uint8Array(await file.slice(Math.max(0, file.size - sampleSize)).arrayBuffer())
    payload = new Uint8Array(metadata.length + first.length + last.length)
    payload.set(metadata)
    payload.set(first, metadata.length)
    payload.set(last, metadata.length + first.length)
  }
  const digest = await crypto.subtle.digest('SHA-256', payload)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  let source: Blob = file
  const mimeType = getUploadMimeType(file)
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
    source = Array.isArray(converted) ? converted[0] : converted
  }
  if ('createImageBitmap' in window) return createImageBitmap(source)
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(source)
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image could not be decoded')) }
    image.src = url
  })
}

async function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image conversion failed')), 'image/webp', quality))
}

async function resizeDecoded(decoded: ImageBitmap | HTMLImageElement, maxDimension: number, quality: number) {
  const sourceWidth = decoded.width
  const sourceHeight = decoded.height
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Image conversion is unavailable in this browser')
  context.drawImage(decoded, 0, 0, width, height)
  return { blob: await canvasToBlob(canvas, quality), width, height }
}

export type PreparedDerivative = { kind: 'display' | 'thumbnail'; blob: Blob; intent: UploadVariantIntent }

export async function createImageDerivatives(file: File): Promise<PreparedDerivative[]> {
  const decoded = await decodeImage(file)
  try {
    const display = await resizeDecoded(decoded, 1800, 0.84)
    const thumbnail = await resizeDecoded(decoded, 480, 0.72)
    return [
      { kind: 'display', blob: display.blob, intent: { kind: 'display', size: display.blob.size, mimeType: 'image/webp', width: display.width, height: display.height } },
      { kind: 'thumbnail', blob: thumbnail.blob, intent: { kind: 'thumbnail', size: thumbnail.blob.size, mimeType: 'image/webp', width: thumbnail.width, height: thumbnail.height } },
    ]
  } finally {
    if ('close' in decoded && typeof decoded.close === 'function') decoded.close()
  }
}
