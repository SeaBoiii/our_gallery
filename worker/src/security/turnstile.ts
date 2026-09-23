import type { Env } from '../env'
import { isDevelopment } from '../env'
import { HttpError } from '../lib/http'

type TurnstileResult = { success: boolean; hostname?: string; action?: string; ['error-codes']?: string[] }
export type TurnstileAction = 'upload_prepare' | 'greeting_submit'

export async function verifyTurnstile(env: Env, token: string, remoteIp: string, action: TurnstileAction = 'upload_prepare') {
  if (isDevelopment(env) && env.TURNSTILE_BYPASS === 'true' && token === 'development-bypass') return
  if (!token || token.length > 2048) throw new HttpError(400, 'TURNSTILE_REQUIRED', 'We couldn’t verify this upload. Please try again.')
  let response: Response
  try {
    response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: remoteIp }),
    })
  } catch {
    throw new HttpError(503, 'TURNSTILE_UNAVAILABLE', 'We couldn’t verify this upload. Please try again.', true)
  }
  const result = await response.json().catch(() => null) as TurnstileResult | null
  if (!response.ok || !result?.success || result.action !== action || result.hostname !== env.TURNSTILE_EXPECTED_HOSTNAME) throw new HttpError(403, 'TURNSTILE_FAILED', 'We couldn’t verify this submission. Please try again.', true)
}
