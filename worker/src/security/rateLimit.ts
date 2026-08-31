import type { Env } from '../env'
import { HttpError } from '../lib/http'
import { secureValueHash } from './hash'

export async function rateLimit(env: Env, rawKey: string, action: string, limit: number, windowSeconds: number, cost = 1) {
  const now = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds
  const keyHash = await secureValueHash(env, rawKey)
  const row = await env.DB.prepare(`
    INSERT INTO rate_limits (key_hash, action, window_start, count, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key_hash, action, window_start)
    DO UPDATE SET count = count + excluded.count
    RETURNING count
  `).bind(keyHash, action, windowStart, Math.max(1, Math.ceil(cost)), windowStart + windowSeconds * 2).first<{ count: number }>()
  if ((row?.count || 1) > limit) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.', true)
}

export function clientIp(request: Request) {
  return request.headers.get('CF-Connecting-IP') || 'local-development'
}

export function guestSession(request: Request) {
  const session = request.headers.get('X-Gallery-Session') || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(session)) throw new HttpError(400, 'INVALID_SESSION', 'Please refresh the page and try again.')
  return session
}
