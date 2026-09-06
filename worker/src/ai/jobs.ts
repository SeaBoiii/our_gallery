import type { Env } from '../env'
import { safeErrorMessage, safeLog } from '../lib/log'
import { readOperationalSettings } from '../settings'
import { AI_ANALYSIS_VERSION, AI_MESSAGE_SCHEMA_VERSION, type AiJobRow, type AiJobType, type AiQueueMessage } from './types'

const ANALYSIS_TYPES: AiJobType[] = ['ANALYSE_MEDIA', 'REPROCESS_MEDIA']
const CLEANUP_TYPES: AiJobType[] = ['DELETE_MEDIA_AI', 'PURGE_MEDIA_FACES', 'PURGE_ALL_FACES']

export function approvalAiOutboxStatements(
  env: Env,
  mediaIds: string[],
  requestedBy: string,
  now: string,
) {
  if (!mediaIds.length) return []
  const placeholders = mediaIds.map(() => '?').join(',')
  return [
    env.DB.prepare(`INSERT INTO media_ai (
      media_id,overall_status,categorisation_status,caption_status,face_index_status,semantic_index_status,
      analysis_schema_version,queued_at,updated_at,active_analysis_job_id,active_face_job_id
    ) SELECT m.id,'queued','queued','queued','queued','queued',?,?,?,
      'analyse:' || m.id || ':approval:' || m.moderation_revision || ':v${AI_ANALYSIS_VERSION}',
      'analyse:' || m.id || ':approval:' || m.moderation_revision || ':v${AI_ANALYSIS_VERSION}'
      FROM media m WHERE m.id IN (${placeholders}) AND m.status='approved'
        AND COALESCE((SELECT value FROM settings WHERE key='auto_ai_processing'),'true')='true'
        AND COALESCE((SELECT value FROM settings WHERE key='ai_enabled'),'true')='true'
      ON CONFLICT(media_id) DO UPDATE SET
        overall_status='queued',categorisation_status='queued',caption_status='queued',face_index_status='queued',semantic_index_status='queued',
        analysis_schema_version=excluded.analysis_schema_version,queued_at=excluded.queued_at,updated_at=excluded.updated_at,
        active_analysis_job_id=excluded.active_analysis_job_id,active_face_job_id=excluded.active_face_job_id,
        last_error_code=NULL,last_error_message=NULL
      WHERE media_ai.active_analysis_job_id IS NOT excluded.active_analysis_job_id`)
      .bind(AI_ANALYSIS_VERSION, now, now, ...mediaIds),
    env.DB.prepare(`INSERT INTO ai_jobs (
      id,idempotency_key,job_type,media_id,analysis_version,requested_by,status,priority,
      attempt_count,max_attempts,available_at,created_at,updated_at
    ) SELECT 'analyse:' || m.id || ':approval:' || m.moderation_revision || ':v${AI_ANALYSIS_VERSION}',
      'analyse:' || m.id || ':approval:' || m.moderation_revision || ':v${AI_ANALYSIS_VERSION}',
      'ANALYSE_MEDIA',m.id,?,?,'queued',100,0,6,?,?,?
      FROM media m WHERE m.id IN (${placeholders}) AND m.status='approved'
        AND COALESCE((SELECT value FROM settings WHERE key='auto_ai_processing'),'true')='true'
        AND COALESCE((SELECT value FROM settings WHERE key='ai_enabled'),'true')='true'
      ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(AI_ANALYSIS_VERSION, requestedBy, now, now, now, ...mediaIds),
  ]
}

export function cleanupAiOutboxStatements(env: Env, mediaIds: string[], requestedBy: string, now: string) {
  if (!mediaIds.length) return []
  const placeholders = mediaIds.map(() => '?').join(',')
  return [
    env.DB.prepare(`UPDATE media_ai SET
      overall_status='disabled',categorisation_status='disabled',caption_status='disabled',face_index_status='disabled',semantic_index_status='disabled',
      active_analysis_job_id='delete-ai:' || media_id || ':moderation:' ||
        (SELECT moderation_revision FROM media WHERE id=media_ai.media_id) || ':v${AI_ANALYSIS_VERSION}',
      active_face_job_id='delete-ai:' || media_id || ':moderation:' ||
        (SELECT moderation_revision FROM media WHERE id=media_ai.media_id) || ':v${AI_ANALYSIS_VERSION}',updated_at=?
      WHERE media_id IN (${placeholders})`)
      .bind(now, ...mediaIds),
    env.DB.prepare(`INSERT INTO ai_jobs (
    id,idempotency_key,job_type,media_id,analysis_version,requested_by,status,priority,
    attempt_count,max_attempts,available_at,created_at,updated_at
  ) SELECT 'delete-ai:' || m.id || ':moderation:' || m.moderation_revision || ':v${AI_ANALYSIS_VERSION}',
    'delete-ai:' || m.id || ':moderation:' || m.moderation_revision || ':v${AI_ANALYSIS_VERSION}',
    'DELETE_MEDIA_AI',m.id,?,?,'queued',10,0,10,?,?,?
    FROM media m WHERE m.id IN (${placeholders})
    ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(AI_ANALYSIS_VERSION, requestedBy, now, now, now, ...mediaIds),
  ]
}

export function reprocessAiOutboxStatements(env: Env, mediaIds: string[], requestedBy: string, now: string, uniqueSuffix: string) {
  if (!mediaIds.length) return []
  const placeholders = mediaIds.map(() => '?').join(',')
  return [
    env.DB.prepare(`INSERT INTO media_ai (
      media_id,overall_status,categorisation_status,caption_status,face_index_status,semantic_index_status,
      analysis_schema_version,queued_at,updated_at,active_analysis_job_id,active_face_job_id
    ) SELECT m.id,'queued','queued','queued','queued','queued',?,?,?,
      'reprocess:' || m.id || ':' || ?,'reprocess:' || m.id || ':' || ? FROM media m
      WHERE m.id IN (${placeholders}) AND m.status='approved'
    ON CONFLICT(media_id) DO UPDATE SET
      overall_status='queued',categorisation_status='queued',caption_status='queued',face_index_status='queued',semantic_index_status='queued',
      active_analysis_job_id=excluded.active_analysis_job_id,active_face_job_id=excluded.active_face_job_id,
      last_error_code=NULL,last_error_message=NULL,queued_at=excluded.queued_at,updated_at=excluded.updated_at`)
      .bind(AI_ANALYSIS_VERSION, now, now, uniqueSuffix, uniqueSuffix, ...mediaIds),
    env.DB.prepare(`INSERT INTO ai_jobs (
      id,idempotency_key,job_type,media_id,analysis_version,requested_by,status,priority,
      attempt_count,max_attempts,available_at,created_at,updated_at
    ) SELECT 'reprocess:' || m.id || ':' || ?, 'reprocess:' || m.id || ':' || ?,
      'REPROCESS_MEDIA',m.id,?,?,'queued',50,0,6,?,?,? FROM media m
      WHERE m.id IN (${placeholders}) AND m.status='approved'
      ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(uniqueSuffix, uniqueSuffix, AI_ANALYSIS_VERSION, requestedBy, now, now, now, ...mediaIds),
  ]
}

export function faceToggleAiOutboxStatements(env: Env, mediaId: string, enabled: boolean, targetRevision: number, requestedBy: string, now: string) {
  const prefix = enabled ? 'face-enable' : 'face-purge'
  const jobType: AiJobType = enabled ? 'REPROCESS_MEDIA' : 'PURGE_MEDIA_FACES'
  const priority = enabled ? 25 : 5
  const maxAttempts = enabled ? 6 : 10
  const jobId = `'${prefix}:' || m.id || ':' || m.face_search_revision || ':v${AI_ANALYSIS_VERSION}'`
  const mediaAiStatement = enabled
    ? env.DB.prepare(`INSERT INTO media_ai (
        media_id,overall_status,categorisation_status,caption_status,face_index_status,semantic_index_status,
        analysis_schema_version,queued_at,updated_at,active_analysis_job_id,active_face_job_id
      ) SELECT m.id,'queued','queued','queued','queued','queued',?,?,?,${jobId},${jobId}
        FROM media m WHERE m.id=? AND m.status='approved' AND m.face_search_enabled=1 AND m.face_search_revision=?
      ON CONFLICT(media_id) DO UPDATE SET
        overall_status='queued',categorisation_status='queued',caption_status='queued',face_index_status='queued',semantic_index_status='queued',
        active_analysis_job_id=excluded.active_analysis_job_id,active_face_job_id=excluded.active_face_job_id,
        last_error_code=NULL,last_error_message=NULL,queued_at=excluded.queued_at,updated_at=excluded.updated_at
      WHERE media_ai.active_analysis_job_id IS NOT excluded.active_analysis_job_id`)
      .bind(AI_ANALYSIS_VERSION, now, now, mediaId, targetRevision)
    : env.DB.prepare(`UPDATE media_ai SET face_index_status='disabled',active_face_job_id=(
        SELECT 'face-purge:' || m.id || ':' || m.face_search_revision || ':v${AI_ANALYSIS_VERSION}' FROM media m WHERE m.id=media_ai.media_id
      ),updated_at=? WHERE media_id=? AND EXISTS (
        SELECT 1 FROM media m WHERE m.id=media_ai.media_id AND m.status='approved' AND m.face_search_enabled=0 AND m.face_search_revision=?
      )`).bind(now, mediaId, targetRevision)
  return [
    mediaAiStatement,
    env.DB.prepare(`INSERT INTO ai_jobs (
      id,idempotency_key,job_type,media_id,analysis_version,requested_by,status,priority,
      attempt_count,max_attempts,available_at,created_at,updated_at
    ) SELECT ${jobId},${jobId},?,m.id,?,?,'queued',?,0,?,?,?,?
      FROM media m WHERE m.id=? AND m.status='approved' AND m.face_search_enabled=? AND m.face_search_revision=?
      ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(jobType, AI_ANALYSIS_VERSION, requestedBy, priority, maxAttempts, now, now, now, mediaId, enabled ? 1 : 0, targetRevision),
  ]
}

export async function enqueueAiJob(
  env: Env,
  type: AiJobType,
  mediaId: string | null,
  requestedBy: string,
  options: { uniqueSuffix?: string; priority?: number; availableAt?: string } = {},
) {
  const now = new Date().toISOString()
  const suffix = options.uniqueSuffix || `v${AI_ANALYSIS_VERSION}`
  const scope = mediaId || 'all'
  const idempotencyKey = `${type.toLowerCase()}:${scope}:${suffix}`
  const id = idempotencyKey
  const statements: D1PreparedStatement[] = []
  if (mediaId && ANALYSIS_TYPES.includes(type)) {
    statements.push(env.DB.prepare(`INSERT INTO media_ai (
      media_id,overall_status,categorisation_status,caption_status,face_index_status,semantic_index_status,
      analysis_schema_version,queued_at,updated_at,active_analysis_job_id,active_face_job_id
    ) VALUES (?,'queued','queued','queued','queued','queued',?,?,?,?,?)
    ON CONFLICT(media_id) DO UPDATE SET
      overall_status='queued',categorisation_status='queued',caption_status='queued',face_index_status='queued',semantic_index_status='queued',
      active_analysis_job_id=excluded.active_analysis_job_id,active_face_job_id=excluded.active_face_job_id,
      last_error_code=NULL,last_error_message=NULL,queued_at=excluded.queued_at,updated_at=excluded.updated_at`)
      .bind(mediaId, AI_ANALYSIS_VERSION, now, now, id, id))
  } else if (mediaId && type === 'PURGE_MEDIA_FACES') {
    statements.push(env.DB.prepare("UPDATE media_ai SET active_face_job_id=?,face_index_status='disabled',updated_at=? WHERE media_id=?")
      .bind(id, now, mediaId))
  } else if (type === 'PURGE_ALL_FACES') {
    statements.push(env.DB.prepare("UPDATE media_ai SET active_face_job_id=?,face_index_status='disabled',updated_at=?")
      .bind(id, now))
  }
  statements.push(env.DB.prepare(`INSERT INTO ai_jobs (
    id,idempotency_key,job_type,media_id,analysis_version,requested_by,status,priority,
    attempt_count,max_attempts,available_at,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,'queued',?,0,6,?,?,?)
  ON CONFLICT(idempotency_key) DO UPDATE SET
    status=CASE WHEN ai_jobs.status IN ('failed','dismissed','cancelled') THEN 'queued' ELSE ai_jobs.status END,
    available_at=CASE WHEN ai_jobs.status IN ('failed','dismissed','cancelled') THEN excluded.available_at ELSE ai_jobs.available_at END,
    last_error_code=CASE WHEN ai_jobs.status IN ('failed','dismissed','cancelled') THEN NULL ELSE ai_jobs.last_error_code END,
    last_error_message=CASE WHEN ai_jobs.status IN ('failed','dismissed','cancelled') THEN NULL ELSE ai_jobs.last_error_message END,
    attempt_count=CASE WHEN ai_jobs.status IN ('failed','dismissed','cancelled') THEN 0 ELSE ai_jobs.attempt_count END,
    workflow_id=CASE WHEN ai_jobs.status IN ('failed','dismissed','cancelled') THEN NULL ELSE ai_jobs.workflow_id END,
    started_at=CASE WHEN ai_jobs.status IN ('failed','dismissed','cancelled') THEN NULL ELSE ai_jobs.started_at END,
    completed_at=CASE WHEN ai_jobs.status IN ('failed','dismissed','cancelled') THEN NULL ELSE ai_jobs.completed_at END,
    dispatch_token=CASE WHEN ai_jobs.status IN ('failed','dismissed','cancelled') THEN NULL ELSE ai_jobs.dispatch_token END,
    updated_at=excluded.updated_at`)
    .bind(id, idempotencyKey, type, mediaId, AI_ANALYSIS_VERSION, requestedBy, options.priority ?? 100, options.availableAt || now, now, now))
  await env.DB.batch(statements)
  return id
}

type Dispatch = { id: string; token: string }

async function writeDispatchTokens(env: Env, dispatches: Dispatch[], now: string) {
  if (!dispatches.length) return 0
  const result = await env.DB.prepare(`WITH tokens AS (
      SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.token') AS token FROM json_each(?)
    ) UPDATE ai_jobs SET dispatch_token=(SELECT token FROM tokens WHERE tokens.id=ai_jobs.id),updated_at=?
    WHERE status='queued' AND EXISTS (SELECT 1 FROM tokens WHERE tokens.id=ai_jobs.id)`)
    .bind(JSON.stringify(dispatches), now).run()
  return result.meta.changes || 0
}

async function markDispatched(env: Env, dispatches: Dispatch[], now: string) {
  if (!dispatches.length) return 0
  const result = await env.DB.prepare(`WITH tokens AS (
      SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.token') AS token FROM json_each(?)
    ) UPDATE ai_jobs SET status='dispatched',dispatched_at=?,updated_at=?
    WHERE status='queued' AND EXISTS (
      SELECT 1 FROM tokens WHERE tokens.id=ai_jobs.id AND tokens.token=ai_jobs.dispatch_token
    )`).bind(JSON.stringify(dispatches), now, now).run()
  return result.meta.changes || 0
}

async function dispatchGroup(env: Env, queue: Queue<AiQueueMessage> | undefined, jobs: AiJobRow[]) {
  if (!queue || !jobs.length) return 0
  const dispatches = jobs.map((job) => ({ id:job.id,token:crypto.randomUUID() }))
  await writeDispatchTokens(env, dispatches, new Date().toISOString())
  const messages = jobs.map((job,index) => ({
    body: {
      schemaVersion: AI_MESSAGE_SCHEMA_VERSION,
      jobId: job.id,
      type: job.job_type,
      mediaId: job.media_id,
      analysisVersion: job.analysis_version,
      dispatchToken: dispatches[index].token,
    } satisfies AiQueueMessage,
    contentType: 'json' as const,
  }))
  await queue.sendBatch(messages)
  await markDispatched(env, dispatches, new Date().toISOString())
  return jobs.length
}

export async function dispatchPendingAiJobs(env: Env, limit = 50) {
  const boundedLimit = Math.min(100, Math.max(1, limit))
  const settings = await readOperationalSettings(env)
  const result = await env.DB.prepare(`SELECT id,job_type,media_id,analysis_version,status,attempt_count
    FROM ai_jobs WHERE status='queued' AND available_at <= ? ORDER BY priority ASC,created_at ASC LIMIT ?`)
    .bind(new Date().toISOString(), boundedLimit).all<AiJobRow>()
  const cleanupJobs = result.results.filter((job) => CLEANUP_TYPES.includes(job.job_type))
  const analysisJobs = settings.aiEnabled && !settings.aiProcessingPaused
    ? result.results.filter((job) => ANALYSIS_TYPES.includes(job.job_type))
    : []
  let dispatched = 0
  dispatched += await dispatchGroup(env, env.CLEANUP_QUEUE || env.AI_PROCESSING_QUEUE, cleanupJobs)
  dispatched += await dispatchGroup(env, env.AI_PROCESSING_QUEUE, analysisJobs)
  if (dispatched) safeLog('info', 'ai_outbox_dispatched', { count: dispatched })
  return dispatched
}

function validMessage(value: unknown): value is AiQueueMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<AiQueueMessage>
  return message.schemaVersion === AI_MESSAGE_SCHEMA_VERSION && typeof message.jobId === 'string' &&
    [...ANALYSIS_TYPES, ...CLEANUP_TYPES].includes(message.type as AiJobType) &&
    (message.mediaId === null || typeof message.mediaId === 'string') && Number.isInteger(message.analysisVersion) &&
    typeof message.dispatchToken === 'string' && message.dispatchToken.length >= 16
}

async function deferPausedMessage(env: Env, message: Message<AiQueueMessage>) {
  const availableAt = new Date(Date.now() + 5 * 60_000).toISOString()
  await env.DB.prepare("UPDATE ai_jobs SET status='queued',dispatch_token=NULL,available_at=?,updated_at=? WHERE id=? AND status IN ('queued','dispatched') AND dispatch_token=?")
    .bind(availableAt, new Date().toISOString(), message.body.jobId, message.body.dispatchToken).run()
  message.ack()
}

async function consumeDeadLetter(env: Env, batch: MessageBatch<AiQueueMessage>) {
  const now = new Date().toISOString()
  for (const message of batch.messages) {
    if (validMessage(message.body)) {
      const failed = await env.DB.prepare(`UPDATE ai_jobs SET status='failed',last_error_code='QUEUE_DEAD_LETTER',
        last_error_message='The job exhausted its Queue retries.',completed_at=?,updated_at=?
        WHERE id=? AND status IN ('queued','dispatched') AND dispatch_token=?`)
        .bind(now, now, message.body.jobId, message.body.dispatchToken).run()
      if (failed.meta.changes) safeLog('error', 'ai_job_dead_letter', { jobId: message.body.jobId, mediaId: message.body.mediaId })
    }
    message.ack()
  }
}

export async function consumeAiQueue(env: Env, batch: MessageBatch<AiQueueMessage>) {
  if (batch.queue.includes('dead-letter')) return consumeDeadLetter(env, batch)
  const settings = await readOperationalSettings(env)
  const ready: Message<AiQueueMessage>[] = []
  for (const message of batch.messages) {
    if (!validMessage(message.body)) {
      safeLog('warn', 'ai_queue_invalid_message')
      message.ack()
      continue
    }
    if (ANALYSIS_TYPES.includes(message.body.type) && (!settings.aiEnabled || settings.aiProcessingPaused)) {
      await deferPausedMessage(env, message)
      continue
    }
    ready.push(message)
  }
  if (!ready.length) return
  if (!env.MEDIA_ANALYSIS_WORKFLOW) {
    for (const message of ready) message.retry({ delaySeconds: 60 })
    safeLog('error', 'ai_workflow_binding_missing', { count: ready.length })
    return
  }

  for (const message of ready) {
    const now = new Date().toISOString()
    const workflowId = `ai:${message.body.dispatchToken}`
    const claim = await env.DB.prepare(`UPDATE ai_jobs SET status='processing',workflow_id=?,attempt_count=attempt_count+1,
      started_at=COALESCE(started_at,?),updated_at=?
      WHERE id=? AND status IN ('queued','dispatched') AND dispatch_token=? AND attempt_count < max_attempts`)
      .bind(workflowId, now, now, message.body.jobId, message.body.dispatchToken).run()
    let shouldCreateWorkflow = Boolean(claim.meta.changes)
    if (!claim.meta.changes) {
      const current = await env.DB.prepare('SELECT status,workflow_id,dispatch_token,attempt_count,max_attempts FROM ai_jobs WHERE id=?')
        .bind(message.body.jobId).first<{ status:string;workflow_id:string|null;dispatch_token:string|null;attempt_count:number;max_attempts:number }>()
      if (current?.status === 'processing' && current.workflow_id === workflowId && current.dispatch_token === message.body.dispatchToken) {
        try {
          const instance = await env.MEDIA_ANALYSIS_WORKFLOW.get(workflowId)
          if ((await instance.status()).status !== 'unknown') {
            message.ack()
            continue
          }
          shouldCreateWorkflow = true
        } catch (error) {
          safeLog('warn','ai_workflow_status_unavailable',{ jobId:message.body.jobId,error:safeErrorMessage(error) })
          message.retry({ delaySeconds:60 })
          continue
        }
      } else if (!current || current.status === 'complete' || current.status === 'partial' || current.status === 'cancelled' || current.dispatch_token !== message.body.dispatchToken) {
        message.ack()
        continue
      }
      if (!shouldCreateWorkflow) {
        const exhausted = await env.DB.prepare(`UPDATE ai_jobs SET status='failed',last_error_code='AI_ATTEMPTS_EXHAUSTED',
          last_error_message='The job exhausted its configured processing attempts.',completed_at=?,updated_at=?
          WHERE id=? AND status IN ('queued','dispatched') AND dispatch_token=? AND attempt_count>=max_attempts`)
          .bind(now, now, message.body.jobId, message.body.dispatchToken).run()
        if (exhausted.meta.changes) safeLog('error', 'ai_job_attempts_exhausted', { jobId:message.body.jobId,mediaId:message.body.mediaId })
        message.ack()
        continue
      }
    }
    try {
      await env.MEDIA_ANALYSIS_WORKFLOW.create({
        id: workflowId,
        params: message.body,
        retention: { successRetention: '1 day', errorRetention: '7 days' },
      })
      message.ack()
    } catch (error) {
      try {
        const instance = await env.MEDIA_ANALYSIS_WORKFLOW.get(workflowId)
        if ((await instance.status()).status !== 'unknown') {
          message.ack()
          continue
        }
      } catch { /* Fall through and return the fenced claim to Queue delivery. */ }
      await env.DB.prepare(`UPDATE ai_jobs SET status='dispatched',workflow_id=NULL,updated_at=?
        WHERE id=? AND workflow_id=? AND dispatch_token=? AND status='processing'`)
        .bind(new Date().toISOString(), message.body.jobId, workflowId, message.body.dispatchToken).run()
      safeLog('error', 'ai_workflow_start_failed', { jobId: message.body.jobId, error: safeErrorMessage(error) })
      message.retry({ delaySeconds: 60 })
    }
  }
}

export async function reserveAiCapacity(env: Env) {
  const limit = Math.min(3_000, Math.max(1, Number(env.AI_PROCESSING_MAX_PER_MINUTE || 30)))
  const windowStart = Math.floor(Date.now() / 60_000) * 60
  const expiresAt = windowStart + 180
  await env.DB.prepare('INSERT INTO ai_rate_windows(window_start,reservation_count,expires_at) VALUES(?,0,?) ON CONFLICT(window_start) DO NOTHING')
    .bind(windowStart, expiresAt).run()
  const reservation = await env.DB.prepare('UPDATE ai_rate_windows SET reservation_count=reservation_count+1 WHERE window_start=? AND reservation_count < ?')
    .bind(windowStart, limit).run()
  if (!reservation.meta.changes) {
    const error = new Error('AI processing is waiting for the configured per-minute capacity.') as Error & { code: string }
    error.code = 'AI_RATE_LIMITED'
    throw error
  }
}
