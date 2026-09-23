import type { AdminGreeting, AdminGreetingPage, AdminGreetingStats, CreateGreetingReceipt, Greeting, GreetingPage, GreetingStatus } from '../../../shared/contracts'
import type { Env } from '../env'
import { HttpError, json, parseJson, requireOrigin } from '../lib/http'
import { requireAdmin } from '../security/adminSession'
import { base64url, fromBase64url, secureValueHash, textEncoder } from '../security/hash'
import { clientIp, guestSession, rateLimit } from '../security/rateLimit'
import { verifyTurnstile } from '../security/turnstile'

type GreetingRow = {
  id: string
  request_id: string
  session_hash: string
  intent_hash: string
  guest_name: string | null
  message: string
  status: GreetingStatus
  created_at: string
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function publicGreeting(row: GreetingRow): Greeting {
  return { id: row.id, guestName: row.guest_name, message: row.message, createdAt: row.created_at }
}

function encodeCursor(row: GreetingRow) {
  return base64url(textEncoder.encode(JSON.stringify({ createdAt: row.created_at, id: row.id })))
}

function pagination(url: URL) {
  const rawLimit = url.searchParams.get('limit')
  const requestedLimit = rawLimit === null ? 30 : Number(rawLimit)
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) throw new HttpError(400, 'INVALID_LIMIT', 'Choose a valid page size.')
  const limit = Math.min(50, requestedLimit)
  const value = url.searchParams.get('cursor')
  if (!value) return { limit, cursor: null }
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(value)))
    if (!record(parsed) || !validUuid(parsed.id) || typeof parsed.createdAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.createdAt)) || new Date(parsed.createdAt).toISOString() !== parsed.createdAt) throw new Error()
    return { limit, cursor: { id: parsed.id, createdAt: parsed.createdAt } }
  } catch {
    throw new HttpError(400, 'INVALID_CURSOR', 'The guestbook page cursor is invalid.')
  }
}

async function submissionsOpen(env: Env) {
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key='greetings_enabled'").first<{ value: string }>()
  return setting?.value !== 'false'
}

async function greetingPage(request: Request, env: Env, admin: boolean) {
  const url = new URL(request.url)
  const { limit, cursor } = pagination(url)
  const status = admin ? url.searchParams.get('status') : null
  if (status && !['pending', 'approved', 'rejected', 'deleted'].includes(status)) throw new HttpError(400, 'INVALID_STATUS', 'Unknown greeting status.')
  const clauses = admin ? ["status != 'deleted'"] : ["status = 'approved'"]
  const bindings: (string | number)[] = []
  if (status) { clauses.push('status = ?'); bindings.push(status) }
  if (cursor) { clauses.push('(created_at < ? OR (created_at = ? AND id < ?))'); bindings.push(cursor.createdAt, cursor.createdAt, cursor.id) }
  const result = await env.DB.prepare(`SELECT id,guest_name,message,status,created_at FROM greetings
    WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ?`).bind(...bindings, limit + 1).all<GreetingRow>()
  const rows = result.results.slice(0, limit)
  return { rows, nextCursor: result.results.length > limit && rows.length ? encodeCursor(rows[rows.length - 1]) : null }
}

export async function greetingsRoute(request: Request, env: Env) {
  const [page, open] = await Promise.all([greetingPage(request, env, false), submissionsOpen(env)])
  const data: GreetingPage = { items: page.rows.map(publicGreeting), nextCursor: page.nextCursor, submissionsOpen: open }
  return json(request, env, data, 200, { 'Cache-Control': 'no-store' })
}

async function byRequest(env: Env, requestId: string) {
  return env.DB.prepare('SELECT id,request_id,session_hash,intent_hash,status FROM greetings WHERE request_id=?').bind(requestId).first<GreetingRow>()
}

function receipt(request: Request, env: Env, row: GreetingRow, sessionHash: string, intentHash: string, status = 200) {
  if (row.session_hash !== sessionHash || row.intent_hash !== intentHash) throw new HttpError(409, 'REQUEST_ID_CONFLICT', 'This request has changed. Please begin a new greeting.')
  const data: CreateGreetingReceipt = { id: row.id, status: row.status }
  return json(request, env, data, status, { 'Cache-Control': 'no-store' })
}

export async function createGreetingRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const payload = await parseJson<unknown>(request)
  if (!record(payload)) throw new HttpError(400, 'INVALID_GREETING', 'Please enter a greeting.')
  if (!validUuid(payload.requestId)) throw new HttpError(400, 'INVALID_REQUEST_ID', 'Please refresh and try again.')
  if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 1000 || payload.message.includes('\0')) throw new HttpError(400, 'INVALID_GREETING_MESSAGE', 'Please write a greeting of up to 1,000 characters.')
  if (payload.guestName !== undefined && (typeof payload.guestName !== 'string' || payload.guestName.length > 80 || payload.guestName.includes('\0'))) throw new HttpError(400, 'INVALID_GUEST_NAME', 'Please use a name of up to 80 characters.')
  if (typeof payload.turnstileToken !== 'string' || payload.turnstileToken.length > 2048) throw new HttpError(400, 'TURNSTILE_REQUIRED', 'Please complete verification and try again.')
  const name = typeof payload.guestName === 'string' ? payload.guestName.trim() || null : null
  const message = payload.message.trim()
  // Keep the message as plain text. No HTML conversion or markdown rendering.
  const session = guestSession(request)
  const [sessionHash, intentHash] = await Promise.all([
    secureValueHash(env, session),
    secureValueHash(env, JSON.stringify(['greeting', name, message])),
  ])
  const existing = await byRequest(env, payload.requestId)
  // A response lost after the insert is safe to retry with the consumed token,
  // including after moderation/deletion or when submissions have since closed.
  if (existing) return receipt(request, env, existing, sessionHash, intentHash)
  if (!await submissionsOpen(env)) throw new HttpError(403, 'GREETINGS_CLOSED', 'The guestbook is currently closed to new greetings.')
  const ip = clientIp(request)
  await Promise.all([
    rateLimit(env, `greeting-session:${session}`, 'greeting_submit', 5, 600),
    rateLimit(env, `greeting-ip:${ip}`, 'greeting_submit', 300, 600),
  ])
  try {
    await verifyTurnstile(env, payload.turnstileToken, ip, 'greeting_submit')
  } catch (error) {
    // A concurrent duplicate may already have consumed this one-use token.
    const committed = await byRequest(env, payload.requestId)
    if (committed) return receipt(request, env, committed, sessionHash, intentHash)
    throw error
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const result = await env.DB.prepare(`INSERT INTO greetings
    (id,request_id,session_hash,intent_hash,guest_name,message,status,created_at)
    SELECT ?,?,?,?,?,?,'pending',? WHERE NOT EXISTS
      (SELECT 1 FROM settings WHERE key='greetings_enabled' AND value='false')
    ON CONFLICT(request_id) DO NOTHING`).bind(id, payload.requestId, sessionHash, intentHash, name, message, createdAt).run()
  const committed = await byRequest(env, payload.requestId)
  if (!committed) throw new HttpError(403, 'GREETINGS_CLOSED', 'The guestbook is currently closed to new greetings.')
  return receipt(request, env, committed, sessionHash, intentHash, result.meta.changes ? 201 : 200)
}

export async function adminGreetingsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  const page = await greetingPage(request, env, true)
  const items: AdminGreeting[] = page.rows.map((row) => ({ ...publicGreeting(row), status: row.status }))
  const data: AdminGreetingPage = { items, nextCursor: page.nextCursor }
  return json(request, env, data, 200, { 'Cache-Control': 'no-store' })
}

export async function adminGreetingStatsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  await requireAdmin(request, env)
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(status='pending'),0) AS pending,
    COALESCE(SUM(status='approved'),0) AS approved,
    COALESCE(SUM(status='rejected'),0) AS rejected FROM greetings WHERE status!='deleted'`).first<AdminGreetingStats>()
  const data: AdminGreetingStats = { total: Number(row?.total || 0), pending: Number(row?.pending || 0), approved: Number(row?.approved || 0), rejected: Number(row?.rejected || 0) }
  return json(request, env, data, 200, { 'Cache-Control': 'no-store' })
}

export async function adminBatchGreetingsRoute(request: Request, env: Env) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  const payload = await parseJson<unknown>(request)
  if (!record(payload) || !Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 100
    || !payload.ids.every(validUuid) || (payload.status !== 'approved' && payload.status !== 'rejected')) throw new HttpError(400, 'INVALID_MODERATION', 'Choose up to 100 greetings and a moderation action.')
  const ids = [...new Set(payload.ids as string[])]
  const status = payload.status
  const now = new Date().toISOString()
  const timestampColumn = status === 'approved' ? 'approved_at' : 'rejected_at'
  const statements: D1PreparedStatement[] = []
  // The status/timestamp bindings leave room for 98 IDs under D1's limit.
  for (let offset = 0; offset < ids.length; offset += 98) {
    const chunk = ids.slice(offset, offset + 98)
    statements.push(env.DB.prepare(`UPDATE greetings SET status=?,${timestampColumn}=?
      WHERE id IN (${chunk.map(() => '?').join(',')}) AND status IN ('pending','approved','rejected')`).bind(status, now, ...chunk))
  }
  statements.push(env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), `session:${admin.sessionHash.slice(0, 12)}`, `greeting_${status}`, null, JSON.stringify({ ids }), now))
  const results = await env.DB.batch(statements)
  const updated = results.slice(0, -1).reduce((sum, result) => sum + Number(result.meta.changes || 0), 0)
  return json(request, env, { updated }, 200, { 'Cache-Control': 'no-store' })
}

export async function adminDeleteGreetingRoute(request: Request, env: Env, id: string) {
  requireOrigin(request, env)
  const admin = await requireAdmin(request, env)
  if (!validUuid(id)) throw new HttpError(404, 'GREETING_NOT_FOUND', 'This greeting could not be found.')
  const row = await env.DB.prepare('SELECT id,status FROM greetings WHERE id=?').bind(id).first<{ id: string; status: GreetingStatus }>()
  if (!row) throw new HttpError(404, 'GREETING_NOT_FOUND', 'This greeting could not be found.')
  if (row.status !== 'deleted') {
    const now = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare("UPDATE greetings SET status='deleted',guest_name=NULL,message='',deleted_at=? WHERE id=? AND status!='deleted'").bind(now, id),
      env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,NULL,?)')
        .bind(crypto.randomUUID(), `session:${admin.sessionHash.slice(0, 12)}`, 'greeting_deleted', id, now),
    ])
  }
  return json(request, env, { deleted: true }, 200, { 'Cache-Control': 'no-store' })
}
