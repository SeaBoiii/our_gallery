import type { Env } from '../env'
import { readGalleryPolicy } from '../lib/galleryVisibility'
import { getGalleryDownloadStatus } from '../lib/downloadAvailability'
import { corsHeaders, HttpError } from '../lib/http'
import { attachmentDisposition } from '../r2/signing'
import { validMediaDownload } from '../security/mediaDownload'
import { findVisibleMedia } from './gallery'

type Variant = 'display' | 'thumbnail' | 'original'
const notFound = () => new HttpError(404, 'MEDIA_NOT_FOUND', 'This memory could not be found.')

function matchesEtag(header: string, etag: string, weak = true) {
  return header.split(',').some((candidate) => {
    const value = candidate.trim()
    return value === '*' || (weak ? value.replace(/^W\//, '') === etag.replace(/^W\//, '') : value === etag && !value.startsWith('W/'))
  })
}

function conditionalStatus(request: Request, object: R2Object): number | null {
  const match = request.headers.get('If-Match')
  if (match && !matchesEtag(match, object.httpEtag, false)) return 412
  const modified = Math.floor(object.uploaded.getTime() / 1000) * 1000
  const unmodified = request.headers.get('If-Unmodified-Since')
  if (!match && unmodified && Number.isFinite(Date.parse(unmodified)) && modified > Date.parse(unmodified)) return 412
  const none = request.headers.get('If-None-Match')
  if (none && matchesEtag(none, object.httpEtag)) return 304
  const since = request.headers.get('If-Modified-Since')
  if (!none && since && Number.isFinite(Date.parse(since)) && modified <= Date.parse(since)) return 304
  return null
}

function byteRange(request: Request, object: R2Object): { offset: number; length: number } | null | 'unsatisfiable' {
  const range = request.method === 'GET' ? request.headers.get('Range') : null
  if (!range) return null
  const ifRange = request.headers.get('If-Range')
  if (ifRange && !(ifRange === object.httpEtag || (!ifRange.startsWith('"') && !ifRange.startsWith('W/')
    && Number.isFinite(Date.parse(ifRange)) && Math.floor(object.uploaded.getTime() / 1000) <= Date.parse(ifRange) / 1000))) return null
  if (!range.startsWith('bytes=')) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (!match[1] && !match[2]) || range.length > 100 || object.size === 0) return 'unsatisfiable'
  const first = Number(match[1])
  const last = Number(match[2])
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return 'unsatisfiable'
  if (!match[1]) return last > 0 ? { offset: Math.max(0, object.size - last), length: Math.min(object.size, last) } : 'unsatisfiable'
  if (first >= object.size || (match[2] && last < first)) return 'unsatisfiable'
  return { offset: first, length: (match[2] ? Math.min(last, object.size - 1) : object.size - 1) - first + 1 }
}

async function authorizeMedia(request: Request, env: Env, mediaId: string, variant: Variant) {
  if (variant === 'original') {
    const availability = getGalleryDownloadStatus(env.DOWNLOADS_AVAILABLE_AT)
    if (!availability.available) throw new HttpError(403, 'DOWNLOADS_NOT_YET_AVAILABLE', 'Original downloads will be available after the wedding.', false, { availableAt: availability.availableAt })
    if (!await validMediaDownload(request, env, mediaId)) throw notFound()
  }
  const policy = await readGalleryPolicy(env)
  const row = await findVisibleMedia(env, mediaId, policy)
  if (variant === 'original' && !await validMediaDownload(request, env, mediaId)) throw notFound()
  return row
}

/** All public bytes stay behind approval, effective day and (for originals) release/token checks. */
export async function publicMediaRoute(request: Request, env: Env, mediaId: string, variant: Variant) {
  const row = await authorizeMedia(request, env, mediaId, variant)
  const key = variant === 'original' || (variant === 'display' && row.media_type === 'video') ? row.original_object_key
    : variant === 'display' ? row.display_object_key : row.thumbnail_object_key
  if (!key) throw notFound()

  // Authorize before HEAD, Range, or ETag handling; hidden media must never return 304 or metadata.
  const metadata = await env.MEDIA.head(key)
  if (!metadata) throw notFound()
  const headers = corsHeaders(request, env)
  headers.set('Cache-Control', 'private, no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Type', variant === 'original' || (variant === 'display' && row.media_type === 'video') ? row.mime_type : 'image/webp')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('ETag', metadata.httpEtag)
  headers.set('Last-Modified', metadata.uploaded.toUTCString())
  headers.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified')
  if (variant === 'original') headers.set('Content-Disposition', attachmentDisposition(row.original_filename))
  const conditional = conditionalStatus(request, metadata)
  if (conditional) {
    await authorizeMedia(request, env, mediaId, variant)
    return new Response(null, { status: conditional, headers })
  }
  const range = byteRange(request, metadata)
  if (range === 'unsatisfiable') {
    await authorizeMedia(request, env, mediaId, variant)
    headers.set('Content-Range', `bytes */${metadata.size}`)
    return new Response(null, { status: 416, headers })
  }
  headers.set('Content-Length', String(range?.length ?? metadata.size))
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`)
  if (request.method === 'HEAD') {
    await authorizeMedia(request, env, mediaId, variant)
    return new Response(null, { status: 200, headers })
  }
  const object = await env.MEDIA.get(key, range ? { range } : undefined)
  if (!object) throw notFound()
  try {
    // Bucket latency can cross midnight or a moderation/admin change. Recheck at
    // response time and release the fetched stream if access was withdrawn.
    await authorizeMedia(request, env, mediaId, variant)
  } catch (error) {
    await object.body.cancel().catch(() => undefined)
    throw error
  }
  return new Response(object.body, { status: range ? 206 : 200, headers })
}
