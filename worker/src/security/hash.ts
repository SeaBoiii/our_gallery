import type { Env } from '../env'

const encoder = new TextEncoder()

export function base64url(bytes: ArrayBuffer | Uint8Array) {
  const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const value of values) binary += String.fromCharCode(value)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function fromBase64url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function hmac(secret: string, value: string) {
  const key = await hmacKey(secret)
  return crypto.subtle.sign('HMAC', key, encoder.encode(value))
}

export async function secureValueHash(env: Env, value: string) {
  return base64url(await hmac(env.RATE_LIMIT_SECRET || env.ADMIN_SESSION_SECRET, value))
}

export async function verifySecret(candidate: string, expected: string, secret: string) {
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(expected))
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(candidate))
}

export const textEncoder = encoder
