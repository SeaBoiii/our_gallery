import { parseDownloadAvailabilityTimestamp } from './lib/downloadAvailability'

export interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  ENVIRONMENT: 'development' | 'production' | string
  R2_ACCOUNT_ID: string
  R2_BUCKET_NAME: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  ALLOWED_ORIGIN: string
  TURNSTILE_SECRET_KEY: string
  TURNSTILE_EXPECTED_HOSTNAME: string
  TURNSTILE_BYPASS: string
  ADMIN_PASSWORD: string
  ADMIN_SESSION_SECRET: string
  RATE_LIMIT_SECRET: string
  AUTO_APPROVE_UPLOADS: string
  DOWNLOADS_AVAILABLE_AT: string
  UPLOAD_URL_TTL_SECONDS: string
  ADMIN_SESSION_TTL_SECONDS: string
  SOFT_STORAGE_WARNING_GB: string
  HARD_STORAGE_LIMIT_GB: string
}

export const isDevelopment = (env: Env) => env.ENVIRONMENT === 'development'

export function assertSafeConfiguration(env: Env) {
  parseDownloadAvailabilityTimestamp(env.DOWNLOADS_AVAILABLE_AT)
  if (isDevelopment(env)) return
  const required = (name: keyof Env, minimum = 1) => {
    const value = typeof env[name] === 'string' ? env[name] as string : ''
    if (value.length < minimum || /replace[-_ ]?with/i.test(value)) throw new Error(`${String(name)} is missing or still uses a placeholder`)
    return value
  }

  if (env.ENVIRONMENT !== 'production') throw new Error('ENVIRONMENT must be production outside explicit development')
  if (env.TURNSTILE_BYPASS === 'true') throw new Error('Turnstile bypass is forbidden outside development')
  if (!/^[a-f0-9]{32}$/i.test(required('R2_ACCOUNT_ID'))) throw new Error('R2_ACCOUNT_ID must be a Cloudflare account ID')
  required('R2_BUCKET_NAME', 3)
  required('R2_ACCESS_KEY_ID', 16)
  required('R2_SECRET_ACCESS_KEY', 32)
  required('TURNSTILE_SECRET_KEY', 20)
  required('ADMIN_PASSWORD', 16)
  const sessionSecret = required('ADMIN_SESSION_SECRET', 32)
  const rateSecret = required('RATE_LIMIT_SECRET', 32)
  if (sessionSecret === rateSecret) throw new Error('ADMIN_SESSION_SECRET and RATE_LIMIT_SECRET must be different')
  const origin = required('ALLOWED_ORIGIN')
  let parsed: URL
  try { parsed = new URL(origin) } catch { throw new Error('ALLOWED_ORIGIN must be one absolute HTTPS origin') }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || origin.includes(',')) throw new Error('ALLOWED_ORIGIN must be one absolute HTTPS origin')
  if (required('TURNSTILE_EXPECTED_HOSTNAME') !== parsed.hostname) throw new Error('TURNSTILE_EXPECTED_HOSTNAME must match ALLOWED_ORIGIN')
  if (!['true','false'].includes(env.AUTO_APPROVE_UPLOADS)) throw new Error('AUTO_APPROVE_UPLOADS must be true or false')
}
