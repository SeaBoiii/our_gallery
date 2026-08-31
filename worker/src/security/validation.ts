import type { UploadFileIntent } from '../../../shared/contracts'
import { HttpError } from '../lib/http'

const MAX_IMAGE = 25 * 1024 * 1024
const MAX_VIDEO = 250 * 1024 * 1024
const imageTypes = new Map([['image/jpeg', new Set(['jpg', 'jpeg'])], ['image/png', new Set(['png'])], ['image/webp', new Set(['webp'])], ['image/heic', new Set(['heic'])], ['image/heif', new Set(['heif'])]])
const videoTypes = new Map([['video/mp4', new Set(['mp4'])], ['video/quicktime', new Set(['mov'])], ['video/webm', new Set(['webm'])]])

export function validateUploadFile(file: UploadFileIntent) {
  if (!file || typeof file !== 'object') throw new HttpError(400, 'INVALID_FILE', 'One of the selected files could not be read.')
  if (!/^[0-9a-f-]{36}$/i.test(file.clientId || '')) throw new HttpError(400, 'INVALID_CLIENT_ID', 'Please select the file again.')
  if (!file.filename || file.filename.length > 255 || [...file.filename].some((character) => character.charCodeAt(0) < 32)) throw new HttpError(400, 'INVALID_FILENAME', 'One file has an invalid name.')
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new HttpError(400, 'INVALID_SIZE', `${file.filename}: The file size is invalid.`)
  if (!/^[a-f0-9]{64}$/i.test(file.fingerprint || '')) throw new HttpError(400, 'INVALID_FINGERPRINT', `${file.filename}: The file fingerprint is invalid.`)
  const extension = file.filename.split('.').pop()?.toLowerCase() || ''
  const mapping = file.mediaType === 'photo' ? imageTypes : file.mediaType === 'video' ? videoTypes : null
  if (!mapping || !mapping.get(file.mimeType)?.has(extension)) throw new HttpError(415, 'UNSUPPORTED_FILE', `${file.filename}: This file format isn't supported yet.`)
  if (file.mediaType === 'photo' && file.size > MAX_IMAGE) throw new HttpError(413, 'FILE_TOO_LARGE', `${file.filename}: This photo is larger than the 25 MB upload limit.`)
  if (file.mediaType === 'video' && file.size > MAX_VIDEO) throw new HttpError(413, 'FILE_TOO_LARGE', `${file.filename}: This video is larger than the 250 MB upload limit.`)
  if (!Array.isArray(file.variants) || file.variants.length > 2) throw new HttpError(400, 'INVALID_VARIANTS', `${file.filename}: Image variants are invalid.`)
  const seen = new Set<string>()
  for (const variant of file.variants) {
    if (file.mediaType !== 'photo' || !['display', 'thumbnail'].includes(variant.kind) || seen.has(variant.kind) || variant.mimeType !== 'image/webp' || !Number.isSafeInteger(variant.size) || variant.size <= 0 || variant.size > 20 * 1024 * 1024 || !Number.isSafeInteger(variant.width) || !Number.isSafeInteger(variant.height) || variant.width <= 0 || variant.height <= 0) throw new HttpError(400, 'INVALID_VARIANT', `${file.filename}: An image variant is invalid.`)
    const limit = variant.kind === 'display' ? 2000 : 520
    if (Math.max(variant.width, variant.height) > limit) throw new HttpError(400, 'INVALID_DIMENSIONS', `${file.filename}: An image variant is too large.`)
    seen.add(variant.kind)
  }
}

export function extensionForMime(mime: string) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' } as Record<string, string>)[mime] || 'bin'
}

export function validMagic(mime: string, bytes: Uint8Array) {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length))
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return bytes.slice(0, 8).every((value, index) => value === [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a][index])
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
  if (mime === 'image/heic' || mime === 'image/heif') return ascii(4, 4) === 'ftyp' && ['heic','heix','hevc','hevx','mif1','msf1'].includes(ascii(8, 4))
  if (mime === 'video/mp4') return ascii(4, 4) === 'ftyp'
  if (mime === 'video/quicktime') return ascii(4, 4) === 'ftyp' && ['qt  ','moov','wide'].includes(ascii(8, 4))
  if (mime === 'video/webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  return false
}
