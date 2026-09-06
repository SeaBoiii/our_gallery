import type { CompleteUploadResponse, DerivativeStatus } from '../../../shared/contracts'
import type { Env } from '../env'
import { approvalAiOutboxStatements } from '../ai/jobs'
import { copyObject } from '../r2/signing'
import { verifiedObject } from '../r2/verify'

export type FinalizableUploadRow = {
  id: string
  media_type: 'photo' | 'video'
  mime_type: string
  staging_original_object_key: string
  staging_display_object_key: string | null
  staging_thumbnail_object_key: string | null
  original_object_key: string
  display_object_key: string | null
  thumbnail_object_key: string | null
  size_bytes: number
  display_size_bytes: number
  thumbnail_size_bytes: number
  status: string
}

export function stagingKeys(row: FinalizableUploadRow) {
  return [row.staging_original_object_key, row.staging_display_object_key, row.staging_thumbnail_object_key].filter((key): key is string => Boolean(key))
}

export function finalKeys(row: FinalizableUploadRow) {
  return [row.original_object_key, row.display_object_key, row.thumbnail_object_key].filter((key): key is string => Boolean(key))
}

async function discardInvalidStaging(env: Env, key: string) {
  if (await env.MEDIA.head(key)) await env.MEDIA.delete(key)
}

async function ensurePromoted(env: Env, stagingKey: string | null, finalKey: string | null, expectedSize: number, mimeType: string) {
  if (!stagingKey || !finalKey || expectedSize < 1) return false
  if (await verifiedObject(env, finalKey, expectedSize, mimeType)) return true

  const staging = await verifiedObject(env, stagingKey, expectedSize, mimeType)
  if (!staging) {
    await discardInvalidStaging(env, stagingKey)
    return false
  }

  await copyObject(env, stagingKey, finalKey, mimeType, staging.httpEtag)
  if (!await verifiedObject(env, finalKey, expectedSize, mimeType)) throw new Error(`R2 promotion verification failed for ${finalKey}`)
  return true
}

async function autoApprovalEnabled(env: Env) {
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'auto_approve_uploads'").first<{ value: string }>()
  return setting?.value === 'true' || (setting?.value !== 'false' && env.AUTO_APPROVE_UPLOADS === 'true')
}

export async function finalizeUpload(env: Env, row: FinalizableUploadRow): Promise<{ completed: false } | { completed: true; status: CompleteUploadResponse['status']; derivativeStatus: DerivativeStatus }> {
  const originalReady = await ensurePromoted(env, row.staging_original_object_key, row.original_object_key, row.size_bytes, row.mime_type)
  if (!originalReady) return { completed: false }

  const [displayReady, thumbnailReady] = row.media_type === 'video' ? [false, false] : await Promise.all([
    ensurePromoted(env, row.staging_display_object_key, row.display_object_key, row.display_size_bytes, 'image/webp'),
    ensurePromoted(env, row.staging_thumbnail_object_key, row.thumbnail_object_key, row.thumbnail_size_bytes, 'image/webp'),
  ])
  const derivativeStatus: DerivativeStatus = row.media_type === 'video' ? 'not_required' : displayReady && thumbnailReady ? 'ready' : displayReady || thumbnailReady ? 'partial' : 'unavailable'
  const autoApprove = await autoApprovalEnabled(env)
  const status: CompleteUploadResponse['status'] = autoApprove && (row.media_type === 'video' || derivativeStatus === 'ready') ? 'approved' : 'pending'
  const now = new Date().toISOString()
  const statements = [env.DB.prepare(`UPDATE media SET status = ?, derivative_status = ?, display_object_key = ?, thumbnail_object_key = ?, display_size_bytes = ?, thumbnail_size_bytes = ?, approved_at = ? WHERE id = ? AND status = 'reconciling'`)
    .bind(status, derivativeStatus, displayReady ? row.display_object_key : null, thumbnailReady ? row.thumbnail_object_key : null, displayReady ? row.display_size_bytes : 0, thumbnailReady ? row.thumbnail_size_bytes : 0, status === 'approved' ? now : null, row.id)]
  if (status === 'approved') statements.push(...approvalAiOutboxStatements(env, [row.id], 'system:upload', now))
  const [result] = await env.DB.batch(statements)
  if (!result.meta.changes) {
    const current = await env.DB.prepare('SELECT status, derivative_status FROM media WHERE id = ?').bind(row.id).first<{ status: string; derivative_status: DerivativeStatus }>()
    if (current?.status === 'pending' || current?.status === 'approved') return { completed: true, status: current.status, derivativeStatus: current.derivative_status }
    throw new Error(`Upload ${row.id} changed during finalization`)
  }

  // Final gallery objects were never writable by the guest. Staging cleanup is
  // best-effort here and is authoritatively retried by cron after PUT expiry.
  await env.MEDIA.delete(stagingKeys(row)).catch(() => undefined)
  return { completed: true, status, derivativeStatus }
}
