import type { Env } from '../env'
import { base64url, fromBase64url, hmac, hmacKey, textEncoder } from './hash'

export const MEDIA_DOWNLOAD_TTL_SECONDS = 300
const tokenBody = (origin: string, id: string, expires: number) => `gallery-download-v1\n${origin}\n${id}\n${expires}`
// Derive a separate protocol key; admin-session tokens cannot be used as download tokens.
const downloadSecret = async (env: Env) => base64url(await hmac(env.ADMIN_SESSION_SECRET, 'gallery-download-signing-key-v1'))

export async function signedMediaDownload(request: Request, env: Env, mediaId: string) {
  const url = new URL(`/api/media/${mediaId}/original`, request.url)
  const expires = Math.floor(Date.now() / 1000) + MEDIA_DOWNLOAD_TTL_SECONDS
  const signature = base64url(await hmac(await downloadSecret(env), tokenBody(url.origin, mediaId, expires)))
  url.searchParams.set('expires', String(expires))
  url.searchParams.set('signature', signature)
  return { url: url.href, expiresInSeconds: MEDIA_DOWNLOAD_TTL_SECONDS }
}

export async function validMediaDownload(request: Request, env: Env, mediaId: string) {
  const url = new URL(request.url)
  const expiry = url.searchParams.getAll('expires')
  const signature = url.searchParams.getAll('signature')
  if (expiry.length !== 1 || signature.length !== 1 || !/^\d{1,12}$/.test(expiry[0]) || !/^[A-Za-z0-9_-]{43}$/.test(signature[0])) return false
  const expires = Number(expiry[0])
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + MEDIA_DOWNLOAD_TTL_SECONDS) return false
  try {
    const key = await hmacKey(await downloadSecret(env))
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64url(signature[0]), textEncoder.encode(tokenBody(url.origin, mediaId, expires)))
    return valid && expires > Math.floor(Date.now() / 1000)
  } catch { return false }
}
