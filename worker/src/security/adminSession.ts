import type { Env } from '../env'
import { isDevelopment } from '../env'
import { HttpError } from '../lib/http'
import { base64url, fromBase64url, hmac, hmacKey, secureValueHash, textEncoder, verifySecret } from './hash'

const PROD_COOKIE = '__Host-an_admin'
const DEV_COOKIE = 'an_admin_dev'

function cookieName(env: Env) { return isDevelopment(env) ? DEV_COOKIE : PROD_COOKIE }

function readCookie(request: Request, name: string) {
  const value = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return value?.slice(name.length + 1) || null
}

export async function verifyAdminPassword(env: Env, password: string) {
  if (!password || password.length > 512) return false
  return verifySecret(password, env.ADMIN_PASSWORD, env.ADMIN_SESSION_SECRET)
}

export async function createAdminSession(env: Env) {
  const now = Math.floor(Date.now() / 1000)
  const ttl = Math.min(86_400, Math.max(900, Number(env.ADMIN_SESSION_TTL_SECONDS) || 28_800))
  const expires = now + ttl
  const id = crypto.randomUUID()
  const body = `v1.${id}.${now}.${expires}`
  const signature = base64url(await hmac(env.ADMIN_SESSION_SECRET, body))
  const token = `${body}.${signature}`
  const sessionHash = await secureValueHash(env, id)
  await env.DB.prepare('INSERT INTO admin_sessions (session_hash, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, NULL)').bind(sessionHash, now, expires).run()
  const secure = isDevelopment(env) ? '' : '; Secure'
  return { token, expiresAt: new Date(expires * 1000).toISOString(), cookie: `${cookieName(env)}=${token}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${ttl}` }
}

export async function requireAdmin(request: Request, env: Env) {
  const token = readCookie(request, cookieName(env))
  if (!token) throw new HttpError(401, 'ADMIN_REQUIRED', 'Admin sign-in is required.')
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== 'v1' || token.length > 512) throw new HttpError(401, 'INVALID_SESSION', 'Your admin session has expired.')
  const [, id, issuedRaw, expiresRaw, signatureRaw] = parts
  const issued = Number(issuedRaw)
  const expires = Number(expiresRaw)
  const now = Math.floor(Date.now() / 1000)
  const maxTtl = Math.min(86_400, Math.max(900, Number(env.ADMIN_SESSION_TTL_SECONDS) || 28_800))
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || issued > now + 60 || expires <= now || expires - issued > maxTtl) throw new HttpError(401, 'SESSION_EXPIRED', 'Your admin session has expired.')
  const key = await hmacKey(env.ADMIN_SESSION_SECRET)
  const valid = await crypto.subtle.verify('HMAC', key, fromBase64url(signatureRaw), textEncoder.encode(`v1.${id}.${issued}.${expires}`))
  if (!valid) throw new HttpError(401, 'INVALID_SESSION', 'Your admin session is invalid.')
  const sessionHash = await secureValueHash(env, id)
  const row = await env.DB.prepare('SELECT expires_at, revoked_at FROM admin_sessions WHERE session_hash = ?').bind(sessionHash).first<{ expires_at: number; revoked_at: number | null }>()
  if (!row || row.revoked_at || row.expires_at <= now) throw new HttpError(401, 'SESSION_REVOKED', 'Your admin session has expired.')
  return { sessionHash, expiresAt: new Date(expires * 1000).toISOString() }
}

export async function revokeAdminSession(request: Request, env: Env) {
  const session = await requireAdmin(request, env)
  await env.DB.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE session_hash = ?').bind(Math.floor(Date.now() / 1000), session.sessionHash).run()
}

export function clearAdminCookie(env: Env) {
  const secure = isDevelopment(env) ? '' : '; Secure'
  return `${cookieName(env)}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`
}
