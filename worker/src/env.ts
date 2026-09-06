import type { AiQueueMessage, MediaAnalysisParams, WorkersAiBinding } from './ai/types'

export interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  AI?: WorkersAiBinding
  AI_PROCESSING_QUEUE?: Queue<AiQueueMessage>
  CLEANUP_QUEUE?: Queue<AiQueueMessage>
  MEDIA_ANALYSIS_WORKFLOW?: Workflow<MediaAnalysisParams>
  SEMANTIC_INDEX?: Vectorize
  FACE_INDEX?: Vectorize
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
  UPLOAD_URL_TTL_SECONDS: string
  ADMIN_SESSION_TTL_SECONDS: string
  SOFT_STORAGE_WARNING_GB: string
  HARD_STORAGE_LIMIT_GB: string
  MOCK_AI?: string
  VISION_MODEL?: string
  VISION_MODEL_VERSION?: string
  SEMANTIC_MODEL?: string
  SEMANTIC_MODEL_VERSION?: string
  SEMANTIC_EMBEDDING_DIMENSIONS?: string
  AI_PROCESSING_MAX_PER_MINUTE?: string
  FACE_PROVIDER?: string
  FACE_PROVIDER_ENDPOINT?: string
  FACE_PROVIDER_API_KEY?: string
  FACE_EMBEDDING_MODEL?: string
  FACE_EMBEDDING_MODEL_VERSION?: string
  FACE_EMBEDDING_DIMENSIONS?: string
  FACE_DISTANCE_METRIC?: string
  FACE_SCORE_MIN?: string
  FACE_SCORE_MAX?: string
  FACE_QUERY_TOP_K?: string
  FIND_ME_MAX_IMAGE_BYTES?: string
  SEARCH_SESSION_TTL_SECONDS?: string
  ARCHIVE_BUILDER_TOKEN?: string
  MAINTENANCE_TOKEN?: string
  ARCHIVE_DOWNLOAD_TTL_SECONDS?: string
}

export const isDevelopment = (env: Env) => env.ENVIRONMENT === 'development'

export function assertSafeConfiguration(env: Env) {
  if (isDevelopment(env)) return
  const required = (name: keyof Env, minimum = 1) => {
    const value = typeof env[name] === 'string' ? env[name] as string : ''
    if (value.length < minimum || /replace[-_ ]?with/i.test(value)) throw new Error(`${String(name)} is missing or still uses a placeholder`)
    return value
  }

  if (env.ENVIRONMENT !== 'production') throw new Error('ENVIRONMENT must be production outside explicit development')
  if (env.TURNSTILE_BYPASS === 'true') throw new Error('Turnstile bypass is forbidden outside development')
  if (env.MOCK_AI === 'true') throw new Error('MOCK_AI is forbidden outside development')
  if (!/^[a-f0-9]{32}$/i.test(required('R2_ACCOUNT_ID'))) throw new Error('R2_ACCOUNT_ID must be a Cloudflare account ID')
  required('R2_BUCKET_NAME', 3)
  required('R2_ACCESS_KEY_ID', 16)
  required('R2_SECRET_ACCESS_KEY', 32)
  required('TURNSTILE_SECRET_KEY', 20)
  required('ADMIN_PASSWORD', 16)
  required('ARCHIVE_BUILDER_TOKEN', 32)
  required('MAINTENANCE_TOKEN', 32)
  const sessionSecret = required('ADMIN_SESSION_SECRET', 32)
  const rateSecret = required('RATE_LIMIT_SECRET', 32)
  if (sessionSecret === rateSecret) throw new Error('ADMIN_SESSION_SECRET and RATE_LIMIT_SECRET must be different')
  const origin = required('ALLOWED_ORIGIN')
  let parsed: URL
  try { parsed = new URL(origin) } catch { throw new Error('ALLOWED_ORIGIN must be one absolute HTTPS origin') }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || origin.includes(',')) throw new Error('ALLOWED_ORIGIN must be one absolute HTTPS origin')
  if (required('TURNSTILE_EXPECTED_HOSTNAME') !== parsed.hostname) throw new Error('TURNSTILE_EXPECTED_HOSTNAME must match ALLOWED_ORIGIN')
  if (!['true','false'].includes(env.AUTO_APPROVE_UPLOADS)) throw new Error('AUTO_APPROVE_UPLOADS must be true or false')
  const maxPerMinute = Number(env.AI_PROCESSING_MAX_PER_MINUTE || '30')
  if (!Number.isInteger(maxPerMinute) || maxPerMinute < 1 || maxPerMinute > 3_000) throw new Error('AI_PROCESSING_MAX_PER_MINUTE must be an integer from 1 to 3000')
  const integerRange = (name: keyof Env, fallback: number, minimum: number, maximum: number) => {
    const value = Number((env[name] as string | undefined) || String(fallback))
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${String(name)} must be an integer from ${minimum} to ${maximum}`)
  }
  integerRange('FACE_QUERY_TOP_K', 100, 20, 100)
  integerRange('FIND_ME_MAX_IMAGE_BYTES', 6 * 1024 ** 2, 256 * 1024, 10 * 1024 ** 2)
  integerRange('SEARCH_SESSION_TTL_SECONDS', 600, 120, 1_800)
  integerRange('ARCHIVE_DOWNLOAD_TTL_SECONDS', 600, 60, 3_600)

  const semanticDimensions = Number(env.SEMANTIC_EMBEDDING_DIMENSIONS || '1024')
  if (semanticDimensions !== 1024) throw new Error('SEMANTIC_EMBEDDING_DIMENSIONS must match the configured 1024-dimensional semantic index')

  const faceProvider = env.FACE_PROVIDER?.trim()
  if (faceProvider) {
    if (faceProvider === 'mock') throw new Error('The mock face provider is forbidden outside development')
    const endpoint = required('FACE_PROVIDER_ENDPOINT')
    try {
      if (new URL(endpoint).protocol !== 'https:') throw new Error()
    } catch { throw new Error('FACE_PROVIDER_ENDPOINT must be an absolute HTTPS URL') }
    required('FACE_PROVIDER_API_KEY', 16)
    required('FACE_EMBEDDING_MODEL')
    required('FACE_EMBEDDING_MODEL_VERSION')
    const dimensions = Number(required('FACE_EMBEDDING_DIMENSIONS'))
    if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 1_536) throw new Error('FACE_EMBEDDING_DIMENSIONS must be an integer from 1 to 1536')
    if (!['cosine','euclidean','dot-product'].includes(required('FACE_DISTANCE_METRIC'))) throw new Error('FACE_DISTANCE_METRIC is invalid')
    const scoreMin = Number(required('FACE_SCORE_MIN'))
    const scoreMax = Number(required('FACE_SCORE_MAX'))
    if (!Number.isFinite(scoreMin) || !Number.isFinite(scoreMax) || scoreMin >= scoreMax) throw new Error('FACE_SCORE_MIN and FACE_SCORE_MAX must be documented finite bounds for the selected model/metric')
  }
}
