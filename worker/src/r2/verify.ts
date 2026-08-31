import type { Env } from '../env'
import { validMagic } from '../security/validation'

export async function verifiedObject(env: Env, key: string, expectedSize: number, expectedMime: string) {
  const object = await env.MEDIA.head(key)
  if (!object || object.size !== expectedSize) return null
  const contentType = object.httpMetadata?.contentType
  if (contentType !== expectedMime) return null
  const sample = await env.MEDIA.get(key, { range: { offset: 0, length: 32 } })
  if (!sample) return null
  const bytes = new Uint8Array(await sample.arrayBuffer())
  return validMagic(expectedMime, bytes) ? object : null
}

export async function verifyObject(env: Env, key: string, expectedSize: number, expectedMime: string) {
  return Boolean(await verifiedObject(env, key, expectedSize, expectedMime))
}
