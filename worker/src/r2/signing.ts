import { AwsClient } from 'aws4fetch'
import type { SignedUploadTarget } from '../../../shared/contracts'
import type { Env } from '../env'

const clients = new WeakMap<Env, AwsClient>()
const filenameEncoder = new TextEncoder()
const DOWNLOAD_FILENAME_MAX_BYTES = 180
const CONTROL_FORMAT_OR_SURROGATE = /[\p{Cc}\p{Cf}\p{Cs}]/gu
const WINDOWS_PATH_RESERVED_CHARACTERS = /[<>:"/\\|?*]/g
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const SAFE_EXTENSION = /(\.[A-Za-z0-9]{1,16})$/

function objectPath(env: Env, key: string) {
  const path = key.split('/').map(encodeURIComponent).join('/')
  return `/${encodeURIComponent(env.R2_BUCKET_NAME)}/${path}`
}

function objectUrl(env: Env, key: string) {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com${objectPath(env, key)}`
}

function client(env: Env) {
  let value = clients.get(env)
  if (!value) {
    value = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
    clients.set(env, value)
  }
  return value
}

function putTtl(env: Env, ttlSeconds?: number) {
  const configured = Math.min(900, Math.max(60, Number(env.UPLOAD_URL_TTL_SECONDS) || 600))
  if (ttlSeconds === undefined || !Number.isFinite(ttlSeconds)) return configured
  return Math.min(900, Math.max(1, Math.floor(ttlSeconds)))
}

function quotedEtag(etag: string) {
  const value = etag.trim()
  if (!value) throw new TypeError('A source ETag is required for R2 promotion.')
  return value.startsWith('"') && value.endsWith('"') ? value : `"${value}"`
}

export type CopyObjectResult = { ok: true; status: number } | { ok: false; status: 412 }

export async function signedPut(env: Env, key: string, mimeType: string, ttlSeconds?: number): Promise<SignedUploadTarget> {
  const ttl = putTtl(env, ttlSeconds)
  const url = new URL(objectUrl(env, key))
  url.searchParams.set('X-Amz-Expires', String(ttl))
  const requiredHeaders = { 'Content-Type': mimeType, 'If-None-Match': '*' }
  const signed = await client(env).sign(new Request(url, { method: 'PUT', headers: requiredHeaders }), { aws: { signQuery: true, allHeaders: true } })
  return { url: signed.url, requiredHeaders, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() }
}

export async function signedGet(env: Env, key: string, ttlSeconds = 900) {
  const ttl = Math.min(3600, Math.max(60, ttlSeconds))
  const url = new URL(objectUrl(env, key))
  url.searchParams.set('X-Amz-Expires', String(ttl))
  const signed = await client(env).sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } })
  return signed.url
}

function utf8Prefix(value: string, maximumBytes: number) {
  let result = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = filenameEncoder.encode(character).byteLength
    if (bytes + characterBytes > maximumBytes) break
    result += character
    bytes += characterBytes
  }
  return result
}

function trimFilenameEdges(value: string) {
  return value.trim().replace(/^[. ]+|[. ]+$/g, '')
}

function filenameExtension(value: string) {
  return value.match(SAFE_EXTENSION)?.[1] || ''
}

function hasMeaningfulStem(value: string, ascii: boolean) {
  const extension = filenameExtension(value)
  const stem = extension ? value.slice(0, -extension.length) : value
  return ascii ? /[A-Za-z0-9]/.test(stem) : /[\p{L}\p{N}\p{S}]/u.test(stem)
}

function avoidWindowsDeviceName(value: string) {
  const firstComponent = value.split('.')[0].replace(/[. ]+$/g, '')
  return WINDOWS_DEVICE_NAME.test(firstComponent) ? `_${value}` : value
}

function boundedFilename(value: string) {
  if (filenameEncoder.encode(value).byteLength <= DOWNLOAD_FILENAME_MAX_BYTES) return value
  const extension = filenameExtension(value)
  const extensionBytes = filenameEncoder.encode(extension).byteLength
  if (extension && extensionBytes < DOWNLOAD_FILENAME_MAX_BYTES) {
    const stem = utf8Prefix(value.slice(0, -extension.length), DOWNLOAD_FILENAME_MAX_BYTES - extensionBytes).replace(/[. ]+$/g, '')
    if (stem) return `${stem}${extension}`
  }
  return utf8Prefix(value, DOWNLOAD_FILENAME_MAX_BYTES).replace(/[. ]+$/g, '')
}

function unicodeDownloadFilename(filename: string) {
  let value = filename.normalize('NFC')
    .replace(CONTROL_FORMAT_OR_SURROGATE, '')
    .replace(WINDOWS_PATH_RESERVED_CHARACTERS, '_')
    .replace(/\s+/gu, ' ')
    .replace(/_+/g, '_')
  value = trimFilenameEdges(value)
  if (!value || !hasMeaningfulStem(value, false)) value = `download${filenameExtension(value)}`
  value = avoidWindowsDeviceName(value)
  return boundedFilename(value) || 'download'
}

function asciiDownloadFilename(unicodeFilename: string) {
  let value = unicodeFilename.normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
  value = trimFilenameEdges(value)
  if (!value || !hasMeaningfulStem(value, true)) value = `download${filenameExtension(value)}`
  value = avoidWindowsDeviceName(value)
  return boundedFilename(value) || 'download'
}

function encodeRfc5987Value(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function attachmentDisposition(filename: string) {
  const unicodeFilename = unicodeDownloadFilename(filename)
  const asciiFilename = asciiDownloadFilename(unicodeFilename)
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRfc5987Value(unicodeFilename)}`
}

export async function signedDownload(env: Env, key: string, filename: string, ttlSeconds = 300) {
  const ttl = Math.min(3600, Math.max(60, ttlSeconds))
  const url = new URL(objectUrl(env, key))
  url.searchParams.set('X-Amz-Expires', String(ttl))
  url.searchParams.set('response-content-disposition', attachmentDisposition(filename))
  const signed = await client(env).sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } })
  return signed.url
}

export async function copyObject(env: Env, sourceKey: string, destinationKey: string, mimeType: string, sourceEtag: string): Promise<CopyObjectResult> {
  const response = await client(env).fetch(new Request(objectUrl(env, destinationKey), {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'x-amz-copy-source': objectPath(env, sourceKey),
      'x-amz-copy-source-if-match': quotedEtag(sourceEtag),
      'x-amz-metadata-directive': 'REPLACE',
      'cf-copy-destination-if-none-match': '*',
    },
  }), { aws: { allHeaders: true } })

  if (response.body) await response.body.cancel().catch(() => undefined)
  if (response.status === 412) return { ok: false, status: 412 }
  if (!response.ok) throw new Error(`R2 CopyObject failed with status ${response.status}.`)
  return { ok: true, status: response.status }
}
