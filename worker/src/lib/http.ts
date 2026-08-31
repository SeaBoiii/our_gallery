import type { ApiEnvelope } from '../../../shared/contracts'
import type { Env } from '../env'

export class HttpError extends Error {
  status: number
  code: string
  retryable: boolean
  details?: Record<string, unknown>
  constructor(status: number, code: string, message: string, retryable = false, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError || Boolean(
    error && typeof error === 'object' &&
    typeof (error as { status?: unknown }).status === 'number' &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string',
  )
}

export function allowedOrigins(env: Env) {
  return env.ALLOWED_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
}

export function isAllowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get('Origin')
  return origin ? allowedOrigins(env).includes(origin) : false
}

export function requireOrigin(request: Request, env: Env) {
  const origin = request.headers.get('Origin')
  if (!origin) throw new HttpError(403, 'ORIGIN_REQUIRED', 'This request could not be verified.')
  if (origin === 'null' || !allowedOrigins(env).includes(origin)) throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.')
  return origin
}

export function corsHeaders(request: Request, env: Env) {
  const headers = new Headers({ Vary: 'Origin' })
  const origin = request.headers.get('Origin')
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Gallery-Session')
    headers.set('Access-Control-Max-Age', '86400')
  }
  return headers
}

export function json<T>(request: Request, env: Env, data: T, status = 200, additional?: HeadersInit) {
  const body: ApiEnvelope<T> = { ok: true, data }
  const headers = corsHeaders(request, env)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('X-Content-Type-Options', 'nosniff')
  if (additional) new Headers(additional).forEach((value, key) => headers.set(key, value))
  return new Response(JSON.stringify(body), { status, headers })
}

export function errorResponse(request: Request, env: Env, error: unknown) {
  const known = isHttpError(error) ? error : new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.', true)
  if (!isHttpError(error)) console.error('Unhandled worker error', error)
  const body: ApiEnvelope<never> = { ok: false, error: { code: known.code, message: known.message, retryable: known.retryable, details: known.details } }
  const headers = corsHeaders(request, env)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(JSON.stringify(body), { status: known.status, headers })
}

const MAX_JSON_BODY_BYTES = 128 * 1024

function requestTooLarge() {
  return new HttpError(413, 'REQUEST_TOO_LARGE', 'The request is too large.')
}

async function readJsonBody(request: Request) {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength !== null && Number(contentLength) > MAX_JSON_BODY_BYTES) throw requestTooLarge()
  if (!request.body) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_JSON_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw requestTooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function parseJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'This request must use JSON.')
  try { return JSON.parse(await readJsonBody(request)) as T }
  catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'INVALID_JSON', 'The request could not be read.')
  }
}

export function optionsResponse(request: Request, env: Env) {
  const origin = request.headers.get('Origin')
  if (!origin || !allowedOrigins(env).includes(origin)) return errorResponse(request, env, new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.'))
  return new Response(null, { status: 204, headers: corsHeaders(request, env) })
}
