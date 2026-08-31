import { AwsClient } from 'aws4fetch'
import type { SignedUploadTarget } from '../../../shared/contracts'
import type { Env } from '../env'

const clients = new WeakMap<Env, AwsClient>()

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
