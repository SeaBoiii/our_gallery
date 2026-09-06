import type { AiTaskStatus } from '../../../shared/contracts'
import type { Env } from '../env'
import { safeErrorCode, safeErrorMessage, safeLog } from '../lib/log'
import { base64url, textEncoder } from '../security/hash'
import { readOperationalSettings } from '../settings'
import { getFaceProvider } from './faces/providerFactory'
import { reserveAiCapacity } from './jobs'
import { getSemanticProvider } from './semantic/providerFactory'
import type { MediaAnalysisParams } from './types'
import { getVisionProvider } from './vision/providerFactory'
import type { VisionAnalysis } from './vision/analysisSchema'

export type EligibleMedia = {
  id: string
  event_id: string
  event_name: string
  event_date: string
  event_display_name: string
  media_type: 'photo' | 'video'
  display_object_key: string | null
  video_preview_object_key: string | null
  face_search_enabled: number
}

const taskColumn = {
  categorisation: 'categorisation_status',
  caption: 'caption_status',
  face: 'face_index_status',
  semantic: 'semantic_index_status',
} as const

export async function eligibleMedia(env: Env, mediaId: string) {
  return env.DB.prepare(`SELECT m.id,m.event_id,m.media_type,m.display_object_key,m.video_preview_object_key,m.face_search_enabled,
    e.name AS event_name,e.event_date,e.display_name AS event_display_name
    FROM media m JOIN events e ON e.id=m.event_id
    WHERE m.id=? AND m.status='approved' AND m.deleted_at IS NULL AND
      (m.media_type='video' OR (m.display_object_key IS NOT NULL AND m.thumbnail_object_key IS NOT NULL))`)
    .bind(mediaId).first<EligibleMedia>()
}

async function analysisStillCurrent(env: Env, mediaId: string, jobId: string, workflowId: string) {
  return Boolean(await env.DB.prepare(`SELECT 1 AS current FROM media m JOIN media_ai ma ON ma.media_id=m.id
    JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing'
    WHERE m.id=? AND m.status='approved' AND m.deleted_at IS NULL AND ma.active_analysis_job_id=?`)
    .bind(jobId,workflowId,mediaId,jobId).first<{ current:number }>())
}

async function faceStillCurrent(env: Env, mediaId: string, jobId: string, workflowId: string) {
  return Boolean(await env.DB.prepare(`SELECT 1 AS current FROM media m JOIN media_ai ma ON ma.media_id=m.id
    JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing'
    WHERE m.id=? AND m.status='approved' AND m.deleted_at IS NULL AND m.face_search_enabled=1 AND ma.active_face_job_id=?`)
    .bind(jobId,workflowId,mediaId,jobId).first<{ current:number }>())
}

export async function beginAnalysis(env: Env, params: MediaAnalysisParams, workflowId: string) {
  const now = new Date().toISOString()
  const claim = await env.DB.prepare(`UPDATE ai_jobs SET status='processing',started_at=COALESCE(started_at,?),updated_at=?
    WHERE id=? AND workflow_id=? AND status='processing'`).bind(now, now, params.jobId, workflowId).run()
  if (!claim.meta.changes) return null
  if (!params.mediaId) return null
  const [media, settings] = await Promise.all([eligibleMedia(env, params.mediaId), readOperationalSettings(env)])
  if (!media || !settings.aiEnabled || !await analysisStillCurrent(env,params.mediaId,params.jobId,workflowId)) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE ai_jobs SET status='cancelled',last_error_code='MEDIA_INELIGIBLE',
        last_error_message='The media is no longer eligible for this AI generation.',completed_at=?,updated_at=?
        WHERE id=? AND workflow_id=? AND status='processing'`)
        .bind(now, now, params.jobId,workflowId),
      env.DB.prepare(`UPDATE media_ai SET overall_status='disabled',categorisation_status='disabled',caption_status='disabled',
        face_index_status=CASE WHEN active_face_job_id=? THEN 'disabled' ELSE face_index_status END,
        semantic_index_status='disabled',processed_at=?,updated_at=? WHERE media_id=? AND active_analysis_job_id=?
        AND EXISTS (SELECT 1 FROM ai_jobs j WHERE j.id=? AND j.workflow_id=? AND j.status='processing')`)
        .bind(params.jobId,now,now,params.mediaId,params.jobId,params.jobId,workflowId),
    ])
    return null
  }
  await env.DB.prepare(`UPDATE media_ai SET overall_status='processing',processing_started_at=?,updated_at=?
    WHERE media_id=? AND active_analysis_job_id=? AND EXISTS (
      SELECT 1 FROM ai_jobs j WHERE j.id=? AND j.workflow_id=? AND j.status='processing'
    )`).bind(now,now,params.mediaId,params.jobId,params.jobId,workflowId).run()
  return media
}

async function derivativeBytes(env: Env, media: EligibleMedia) {
  const key = media.media_type === 'photo' ? media.display_object_key : media.video_preview_object_key
  if (!key) return null
  const object = await env.MEDIA.get(key)
  if (!object) throw Object.assign(new Error('The gallery derivative is missing.'), { code: 'AI_DERIVATIVE_MISSING' })
  return { bytes: await object.arrayBuffer(), mimeType: object.httpMetadata?.contentType || 'image/webp' }
}

async function setTaskStatus(env: Env, mediaId: string, task: keyof typeof taskColumn, status: AiTaskStatus, jobId: string, workflowId: string) {
  const column = taskColumn[task]
  const ownerColumn = task === 'face' ? 'active_face_job_id' : 'active_analysis_job_id'
  await env.DB.prepare(`UPDATE media_ai SET ${column}=?,updated_at=? WHERE media_id=? AND ${ownerColumn}=? AND EXISTS (
    SELECT 1 FROM ai_jobs j WHERE j.id=? AND j.workflow_id=? AND j.status='processing'
  )`).bind(status,new Date().toISOString(),mediaId,jobId,jobId,workflowId).run()
}

export async function markTaskFailure(env: Env, mediaId: string, task: keyof typeof taskColumn, error: unknown, jobId: string, workflowId: string) {
  const column = taskColumn[task]
  const ownerColumn = task === 'face' ? 'active_face_job_id' : 'active_analysis_job_id'
  const now = new Date().toISOString()
  const code = safeErrorCode(error)
  const message = safeErrorMessage(error)
  await env.DB.prepare(`UPDATE media_ai SET ${column}='failed',last_error_code=?,last_error_message=?,updated_at=?
    WHERE media_id=? AND ${ownerColumn}=? AND EXISTS (
      SELECT 1 FROM ai_jobs j WHERE j.id=? AND j.workflow_id=? AND j.status='processing'
    )`).bind(code,message,now,mediaId,jobId,jobId,workflowId).run()
  safeLog('warn', 'ai_task_failed', { mediaId, task, code })
}

export async function runVisionAnalysis(env: Env, media: EligibleMedia, jobId: string, workflowId: string) {
  const provider = getVisionProvider(env)
  if (!provider) {
    await Promise.all([
      setTaskStatus(env,media.id,'categorisation','disabled',jobId,workflowId),
      setTaskStatus(env,media.id,'caption','disabled',jobId,workflowId),
    ])
    return null
  }
  const derivative = await derivativeBytes(env, media)
  if (!derivative) {
    await Promise.all([
      setTaskStatus(env,media.id,'categorisation','disabled',jobId,workflowId),
      setTaskStatus(env,media.id,'caption','disabled',jobId,workflowId),
    ])
    return null
  }
  await reserveAiCapacity(env)
  await Promise.all([
    setTaskStatus(env,media.id,'categorisation','processing',jobId,workflowId),
    setTaskStatus(env,media.id,'caption','processing',jobId,workflowId),
  ])
  const analysis = await provider.analyse(derivative.bytes, derivative.mimeType, {
    eventName: media.event_display_name,
    eventDate: media.event_date,
    mediaType: media.media_type,
  })
  return { analysis, provider: provider.provider, model: provider.model, modelVersion: provider.modelVersion }
}

export async function persistVisionAnalysis(
  env: Env,
  mediaId: string,
  result: { analysis: VisionAnalysis; provider: string; model: string; modelVersion: string },
  jobId: string,
  workflowId: string,
) {
  if (!await analysisStillCurrent(env,mediaId,jobId,workflowId)) return false
  const now = new Date().toISOString()
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM media_categories WHERE media_id=? AND source='ai' AND EXISTS (
      SELECT 1 FROM media m JOIN media_ai ma ON ma.media_id=m.id JOIN ai_jobs j
        ON j.id=? AND j.workflow_id=? AND j.status='processing'
      WHERE m.id=? AND m.status='approved' AND m.deleted_at IS NULL AND ma.active_analysis_job_id=?)`)
      .bind(mediaId,jobId,workflowId,mediaId,jobId),
  ]
  for (const category of result.analysis.categories) {
    statements.push(env.DB.prepare(`INSERT INTO media_categories(media_id,category_id,confidence,source,analysis_schema_version,created_at,updated_at)
      SELECT ?,c.id,?,'ai',1,?,? FROM categories c
      WHERE c.display_name=? AND c.enabled=1 AND NOT EXISTS (
        SELECT 1 FROM media_category_suppressions s WHERE s.media_id=? AND s.category_id=c.id
      ) AND EXISTS (SELECT 1 FROM media m JOIN media_ai ma ON ma.media_id=m.id JOIN ai_jobs j
        ON j.id=? AND j.workflow_id=? AND j.status='processing'
        WHERE m.id=? AND m.status='approved' AND m.deleted_at IS NULL AND ma.active_analysis_job_id=?)
      ON CONFLICT(media_id,category_id,source) DO UPDATE SET
        confidence=excluded.confidence,analysis_schema_version=excluded.analysis_schema_version,updated_at=excluded.updated_at`)
      .bind(mediaId,category.confidence,now,now,category.name,mediaId,jobId,workflowId,mediaId,jobId))
  }
  statements.push(env.DB.prepare(`UPDATE media_ai SET caption=?,scene=?,objects_json=?,quality_json=?,vision_provider=?,vision_model=?,vision_model_version=?,
    categorisation_status='complete',caption_status='complete',last_error_code=NULL,last_error_message=NULL,updated_at=?
    WHERE media_id=? AND active_analysis_job_id=? AND EXISTS (
      SELECT 1 FROM media m JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing'
      WHERE m.id=media_ai.media_id AND m.status='approved' AND m.deleted_at IS NULL)`)
    .bind(result.analysis.caption, result.analysis.scene, JSON.stringify(result.analysis.objects), JSON.stringify(result.analysis.quality),
      result.provider,result.model,result.modelVersion,now,mediaId,jobId,jobId,workflowId))
  const results=await env.DB.batch(statements)
  return Boolean(results.at(-1)?.meta.changes)
}

type SemanticSourceRow = {
  id: string
  event_id: string
  event_display_name: string
  caption: string | null
  scene: string | null
  categories: string | null
  vision_provider: string | null
  vision_model: string | null
  vision_model_version: string | null
  analysis_schema_version: number
}

async function compactVersion(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)))
  return base64url(digest).slice(0, 10)
}

async function deleteVectorIds(index: Vectorize, ids: string[]) {
  for (let offset=0;offset<ids.length;offset+=500) await index.deleteByIds(ids.slice(offset,offset+500))
}

async function compensateSemanticVector(env: Env, vectorId: string) {
  await Promise.all([
    env.SEMANTIC_INDEX ? deleteVectorIds(env.SEMANTIC_INDEX,[vectorId]).catch(()=>undefined) : Promise.resolve(),
    env.DB.prepare('DELETE FROM media_semantic_vectors WHERE embedding_vector_id=?').bind(vectorId).run().catch(()=>undefined),
  ])
}

export async function indexSemantic(env: Env, media: EligibleMedia, jobId: string, workflowId: string) {
  const settings = await readOperationalSettings(env)
  const provider = getSemanticProvider(env)
  if (!settings.semanticSearchEnabled || !provider || !env.SEMANTIC_INDEX) {
    await setTaskStatus(env,media.id,'semantic','disabled',jobId,workflowId)
    return { indexed: false }
  }
  if (!await analysisStillCurrent(env,media.id,jobId,workflowId)) return { indexed:false }
  const source = await env.DB.prepare(`SELECT m.id,m.event_id,e.display_name AS event_display_name,ma.caption,ma.scene,
    ma.vision_provider,ma.vision_model,ma.vision_model_version,ma.analysis_schema_version,
    (SELECT group_concat(c.display_name, ', ') FROM media_categories mc JOIN categories c ON c.id=mc.category_id
      WHERE mc.media_id=m.id AND c.enabled=1 AND (mc.source='admin' OR NOT EXISTS (
        SELECT 1 FROM media_category_suppressions s WHERE s.media_id=m.id AND s.category_id=mc.category_id
      ))) AS categories
    FROM media m JOIN events e ON e.id=m.event_id JOIN media_ai ma ON ma.media_id=m.id
    JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing'
    WHERE m.id=? AND m.status='approved' AND m.deleted_at IS NULL AND ma.active_analysis_job_id=?`)
    .bind(jobId,workflowId,media.id,jobId).first<SemanticSourceRow>()
  if (!source?.caption) {
    await setTaskStatus(env,media.id,'semantic','disabled',jobId,workflowId)
    return { indexed: false }
  }
  await setTaskStatus(env,media.id,'semantic','processing',jobId,workflowId)
  await reserveAiCapacity(env)
  const text = `${source.caption}\nCategories: ${source.categories || 'Other'}.\nScene: ${source.scene || 'wedding celebration'}.\nEvent: ${source.event_display_name}.`
  const embedding = await provider.embed(text)
  const modelVersion=await compactVersion(`${provider.provider}:${provider.model}:${provider.modelVersion}:${provider.dimensions}:${provider.metric}`)
  const generation=await compactVersion(`${jobId}:${workflowId}`)
  const captionVersion=`schema${source.analysis_schema_version}:${source.vision_provider || 'manual'}:${source.vision_model || 'caption'}:${source.vision_model_version || 'unversioned'}`
  const vectorId=`s:${media.id}:${modelVersion}:${generation}`
  const existing=await env.DB.prepare('SELECT embedding_vector_id FROM media_semantic_vectors WHERE media_id=?')
    .bind(media.id).first<{ embedding_vector_id:string }>()
  let upserted=false
  try {
    if (!await analysisStillCurrent(env,media.id,jobId,workflowId)) return { indexed:false }
    await env.SEMANTIC_INDEX.upsert([{ id:vectorId,values:embedding,metadata:{ media_id:media.id,event_id:media.event_id,caption_version:captionVersion,model_version:provider.modelVersion } }])
    upserted=true
    if (!await analysisStillCurrent(env,media.id,jobId,workflowId)) {
      await compensateSemanticVector(env,vectorId)
      return { indexed:false }
    }
    const now=new Date().toISOString()
    const results=await env.DB.batch([
      env.DB.prepare(`INSERT INTO media_semantic_vectors(media_id,embedding_vector_id,embedding_provider,embedding_model,embedding_model_version,
        embedding_dimensions,distance_metric,caption_version,indexed_at,deleted_at)
        SELECT ?,?,?,?,?,?,?,?,?,NULL WHERE EXISTS (
          SELECT 1 FROM media m JOIN media_ai ma ON ma.media_id=m.id JOIN ai_jobs j
            ON j.id=? AND j.workflow_id=? AND j.status='processing'
          WHERE m.id=? AND m.status='approved' AND m.deleted_at IS NULL AND ma.active_analysis_job_id=?)
        ON CONFLICT(media_id) DO UPDATE SET embedding_vector_id=excluded.embedding_vector_id,embedding_provider=excluded.embedding_provider,
        embedding_model=excluded.embedding_model,embedding_model_version=excluded.embedding_model_version,
        embedding_dimensions=excluded.embedding_dimensions,distance_metric=excluded.distance_metric,caption_version=excluded.caption_version,
        indexed_at=excluded.indexed_at,deleted_at=NULL`)
        .bind(media.id,vectorId,provider.provider,provider.model,provider.modelVersion,provider.dimensions,provider.metric,captionVersion,now,
          jobId,workflowId,media.id,jobId),
      env.DB.prepare(`UPDATE media_ai SET semantic_index_status='complete',semantic_provider=?,semantic_model=?,semantic_model_version=?,
        semantic_dimensions=?,last_error_code=NULL,last_error_message=NULL,updated_at=?
        WHERE media_id=? AND active_analysis_job_id=? AND EXISTS (
          SELECT 1 FROM media m JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing'
          WHERE m.id=media_ai.media_id AND m.status='approved' AND m.deleted_at IS NULL)`)
        .bind(provider.provider,provider.model,provider.modelVersion,provider.dimensions,now,media.id,jobId,jobId,workflowId),
    ])
    const committed=results[0]?.meta.changes && await env.DB.prepare(`SELECT msv.embedding_vector_id FROM media_semantic_vectors msv
      JOIN media_ai ma ON ma.media_id=msv.media_id JOIN media m ON m.id=msv.media_id JOIN ai_jobs j
        ON j.id=? AND j.workflow_id=? AND j.status='processing'
      WHERE msv.media_id=? AND ma.active_analysis_job_id=? AND m.status='approved' AND m.deleted_at IS NULL`)
      .bind(jobId,workflowId,media.id,jobId).first<{ embedding_vector_id:string }>()
    if (!committed || committed.embedding_vector_id!==vectorId) {
      await compensateSemanticVector(env,vectorId)
      return { indexed:false }
    }
    if (existing?.embedding_vector_id && existing.embedding_vector_id!==vectorId) await deleteVectorIds(env.SEMANTIC_INDEX,[existing.embedding_vector_id])
    return { indexed:true }
  } catch (error) {
    if (upserted) await compensateSemanticVector(env,vectorId)
    throw error
  } finally { embedding.fill(0) }
}

export async function indexFaces(env: Env, media: EligibleMedia, jobId: string, workflowId: string) {
  const [settings, provider] = await Promise.all([readOperationalSettings(env), Promise.resolve(getFaceProvider(env))])
  if (!settings.faceSearchEnabled || !media.face_search_enabled || !provider || !env.FACE_INDEX) {
    await setTaskStatus(env,media.id,'face','disabled',jobId,workflowId)
    return { faces: 0, indexed: false }
  }
  const currentBeforeRead=await eligibleMedia(env,media.id)
  if (!currentBeforeRead?.face_search_enabled || !await faceStillCurrent(env,media.id,jobId,workflowId) || !(await readOperationalSettings(env)).faceSearchEnabled) {
    await setTaskStatus(env,media.id,'face','disabled',jobId,workflowId)
    return { faces: 0, indexed: false }
  }
  const derivative = await derivativeBytes(env, currentBeforeRead)
  if (!derivative) {
    await setTaskStatus(env,media.id,'face','disabled',jobId,workflowId)
    return { faces: 0, indexed: false }
  }
  await setTaskStatus(env,media.id,'face','processing',jobId,workflowId)
  await reserveAiCapacity(env)
  const faces = await provider.analyseImage(derivative.bytes, derivative.mimeType)
  if (!await faceStillCurrent(env,media.id,jobId,workflowId) || !(await readOperationalSettings(env)).faceSearchEnabled) {
    await setTaskStatus(env,media.id,'face','disabled',jobId,workflowId)
    faces.forEach((face)=>face.embedding.fill(0))
    return { faces: 0, indexed: false }
  }
  const version=await compactVersion(`${provider.provider}:${provider.model}:${provider.modelVersion}:${provider.dimensions}:${provider.metric}`)
  const generation=await compactVersion(`${jobId}:${workflowId}`)
  const vectorRecords = faces.map((face, faceIndex) => ({
    id: `f:${media.id}:${faceIndex}:${version}:${generation}`,
    values: face.embedding,
    metadata: { face_id:`${media.id}:${faceIndex}:${version}:${generation}`,media_id:media.id,event_id:media.event_id,face_index:faceIndex,model_version:provider.modelVersion },
  }))
  const existing = await env.DB.prepare('SELECT embedding_vector_id FROM detected_faces WHERE media_id=? AND deleted_at IS NULL')
    .bind(media.id).all<{ embedding_vector_id: string }>()
  const currentIds = new Set(vectorRecords.map((record) => record.id))
  const staleIds = existing.results.map((row) => row.embedding_vector_id).filter((id) => !currentIds.has(id))
  try {
    if (vectorRecords.length) await env.FACE_INDEX.upsert(vectorRecords)
    if (!await faceStillCurrent(env,media.id,jobId,workflowId) || !(await readOperationalSettings(env)).faceSearchEnabled) {
      await deleteVectorIds(env.FACE_INDEX,[...currentIds])
      return { faces:0,indexed:false }
    }
    if (staleIds.length) await deleteVectorIds(env.FACE_INDEX,staleIds)
    const now=new Date().toISOString()
    const statements:D1PreparedStatement[]=[
      env.DB.prepare(`DELETE FROM detected_faces WHERE media_id=? AND EXISTS (
        SELECT 1 FROM media m JOIN media_ai ma ON ma.media_id=m.id JOIN ai_jobs j
          ON j.id=? AND j.workflow_id=? AND j.status='processing'
        WHERE m.id=? AND m.status='approved' AND m.deleted_at IS NULL AND m.face_search_enabled=1 AND ma.active_face_job_id=?)`)
        .bind(media.id,jobId,workflowId,media.id,jobId),
    ]
    faces.forEach((face,faceIndex)=>{
      const vectorId=vectorRecords[faceIndex].id
      statements.push(env.DB.prepare(`INSERT INTO detected_faces(id,media_id,face_index,bounding_box_x,bounding_box_y,bounding_box_width,bounding_box_height,
        embedding_vector_id,embedding_provider,embedding_model,embedding_model_version,embedding_dimensions,distance_metric,face_quality_score,indexed_at,created_at,deleted_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL WHERE EXISTS (
          SELECT 1 FROM media m JOIN media_ai ma ON ma.media_id=m.id JOIN ai_jobs j
            ON j.id=? AND j.workflow_id=? AND j.status='processing'
          WHERE m.id=? AND m.status='approved' AND m.deleted_at IS NULL AND m.face_search_enabled=1 AND ma.active_face_job_id=?)`)
        .bind(`${media.id}:${faceIndex}:${version}:${generation}`,media.id,faceIndex,face.bounds.x,face.bounds.y,face.bounds.width,face.bounds.height,
          vectorId,provider.provider,provider.model,provider.modelVersion,provider.dimensions,provider.metric,face.quality,now,now,
          jobId,workflowId,media.id,jobId))
    })
    statements.push(env.DB.prepare(`UPDATE media_ai SET face_index_status='complete',last_error_code=NULL,last_error_message=NULL,updated_at=?
      WHERE media_id=? AND active_face_job_id=? AND EXISTS (
        SELECT 1 FROM media m JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing'
        WHERE m.id=media_ai.media_id AND m.status='approved' AND m.deleted_at IS NULL AND m.face_search_enabled=1)`)
      .bind(now,media.id,jobId,jobId,workflowId))
    const results=await env.DB.batch(statements)
    const statusChanged=Boolean(results.at(-1)?.meta.changes)
    if (!statusChanged || !await faceStillCurrent(env,media.id,jobId,workflowId)) {
      if (currentIds.size) await deleteVectorIds(env.FACE_INDEX,[...currentIds])
      if (currentIds.size) {
        const placeholders=[...currentIds].map(()=>'?').join(',')
        await env.DB.prepare(`DELETE FROM detected_faces WHERE embedding_vector_id IN (${placeholders})`).bind(...currentIds).run()
      }
      return { faces:0,indexed:false }
    }
    return { faces:faces.length,indexed:true }
  } catch (error) {
    if (currentIds.size) await deleteVectorIds(env.FACE_INDEX,[...currentIds]).catch(()=>undefined)
    throw error
  } finally { faces.forEach((face)=>face.embedding.fill(0)) }
}

export async function deleteMediaAi(env: Env, mediaId: string, jobId: string, workflowId: string) {
  const owner=await env.DB.prepare(`SELECT m.status,ma.active_analysis_job_id FROM media m LEFT JOIN media_ai ma ON ma.media_id=m.id
    JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing' WHERE m.id=?`)
    .bind(jobId,workflowId,mediaId).first<{ status:string;active_analysis_job_id:string|null }>()
  if (!owner || owner.status==='approved' || (owner.active_analysis_job_id && owner.active_analysis_job_id!==jobId)) return { deleted:false }
  const [faces,semantic]=await Promise.all([
    env.DB.prepare('SELECT embedding_vector_id FROM detected_faces WHERE media_id=?').bind(mediaId).all<{ embedding_vector_id:string }>(),
    env.DB.prepare('SELECT embedding_vector_id FROM media_semantic_vectors WHERE media_id=?').bind(mediaId).first<{ embedding_vector_id:string }>(),
  ])
  if (faces.results.length && !env.FACE_INDEX) throw Object.assign(new Error('The face Vectorize binding is required to finish deletion.'), { code: 'FACE_INDEX_UNAVAILABLE' })
  if (semantic && !env.SEMANTIC_INDEX) throw Object.assign(new Error('The semantic Vectorize binding is required to finish deletion.'), { code: 'SEMANTIC_INDEX_UNAVAILABLE' })
  if (faces.results.length) await deleteVectorIds(env.FACE_INDEX!,faces.results.map((row)=>row.embedding_vector_id))
  if (semantic) await deleteVectorIds(env.SEMANTIC_INDEX!,[semantic.embedding_vector_id])
  const ownership=`EXISTS (SELECT 1 FROM media m LEFT JOIN media_ai owner ON owner.media_id=m.id JOIN ai_jobs j
    ON j.id=? AND j.workflow_id=? AND j.status='processing'
    WHERE m.id=? AND m.status<>'approved' AND (owner.media_id IS NULL OR owner.active_analysis_job_id=?))`
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM detected_faces WHERE media_id=? AND ${ownership}`).bind(mediaId,jobId,workflowId,mediaId,jobId),
    env.DB.prepare(`DELETE FROM media_semantic_vectors WHERE media_id=? AND ${ownership}`).bind(mediaId,jobId,workflowId,mediaId,jobId),
    env.DB.prepare(`DELETE FROM media_categories WHERE media_id=? AND ${ownership}`).bind(mediaId,jobId,workflowId,mediaId,jobId),
    env.DB.prepare(`DELETE FROM media_category_suppressions WHERE media_id=? AND ${ownership}`).bind(mediaId,jobId,workflowId,mediaId,jobId),
    env.DB.prepare(`DELETE FROM media_ai WHERE media_id=? AND active_analysis_job_id=? AND EXISTS (
      SELECT 1 FROM media m JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing'
      WHERE m.id=media_ai.media_id AND m.status<>'approved')`).bind(mediaId,jobId,jobId,workflowId),
  ])
  return { deleted:true }
}

export async function purgeFaces(env: Env, mediaId: string | null, jobId: string, workflowId: string) {
  let total = 0
  while (true) {
    const result = mediaId
      ? await env.DB.prepare(`SELECT df.id,df.embedding_vector_id FROM detected_faces df JOIN media_ai ma ON ma.media_id=df.media_id
          JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing'
          WHERE df.media_id=? AND ma.active_face_job_id=? LIMIT 500`).bind(jobId,workflowId,mediaId,jobId).all<{ id:string;embedding_vector_id:string }>()
      : await env.DB.prepare(`SELECT df.id,df.embedding_vector_id FROM detected_faces df JOIN media_ai ma ON ma.media_id=df.media_id
          JOIN ai_jobs j ON j.id=? AND j.workflow_id=? AND j.status='processing'
          WHERE ma.active_face_job_id=? ORDER BY df.id LIMIT 500`).bind(jobId,workflowId,jobId).all<{ id:string;embedding_vector_id:string }>()
    if (!result.results.length) break
    if (!env.FACE_INDEX) throw Object.assign(new Error('The face Vectorize binding is required to purge indexed faces.'), { code: 'FACE_INDEX_UNAVAILABLE' })
    await deleteVectorIds(env.FACE_INDEX,result.results.map((row)=>row.embedding_vector_id))
    const ids = result.results.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(',')
    await env.DB.prepare(`DELETE FROM detected_faces WHERE id IN (${placeholders})`).bind(...ids).run()
    total += ids.length
  }
  if (mediaId) await env.DB.prepare(`UPDATE media_ai SET face_index_status='disabled',updated_at=?
    WHERE media_id=? AND active_face_job_id=? AND EXISTS (
      SELECT 1 FROM ai_jobs j WHERE j.id=? AND j.workflow_id=? AND j.status='processing'
    )`).bind(new Date().toISOString(),mediaId,jobId,jobId,workflowId).run()
  else await env.DB.prepare(`UPDATE media_ai SET face_index_status='disabled',updated_at=? WHERE active_face_job_id=? AND EXISTS (
    SELECT 1 FROM ai_jobs j WHERE j.id=? AND j.workflow_id=? AND j.status='processing'
  )`).bind(new Date().toISOString(),jobId,jobId,workflowId).run()
  return total
}

export async function finishAnalysis(env: Env, jobId: string, mediaId: string, workflowId: string) {
  const row=await env.DB.prepare(`SELECT categorisation_status,caption_status,face_index_status,semantic_index_status,active_face_job_id
    FROM media_ai WHERE media_id=? AND active_analysis_job_id=?`).bind(mediaId,jobId)
    .first<Record<string,AiTaskStatus> & { active_face_job_id:string|null }>()
  if (!row) return 'disabled' as AiTaskStatus
  const statuses:AiTaskStatus[]=[row.categorisation_status,row.caption_status,row.semantic_index_status]
  if (row.active_face_job_id===jobId) statuses.push(row.face_index_status)
  const failed = statuses.some((status) => status === 'failed')
  const pending = statuses.some((status) => ['queued','processing','not_requested'].includes(status))
  const overall: AiTaskStatus = failed || pending ? 'partial' : 'complete'
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('UPDATE media_ai SET overall_status=?,processed_at=?,updated_at=? WHERE media_id=? AND active_analysis_job_id=?')
      .bind(overall,now,now,mediaId,jobId),
    env.DB.prepare(`UPDATE ai_jobs SET status=?,completed_at=?,updated_at=?,last_error_code=CASE WHEN ?='complete' THEN NULL ELSE last_error_code END
      WHERE id=? AND workflow_id=? AND status='processing'`)
      .bind(overall==='complete'?'complete':'partial',now,now,overall,jobId,workflowId),
  ])
  return overall
}

export async function failJob(env: Env, jobId: string, workflowId: string, error: unknown) {
  const now = new Date().toISOString()
  const code = safeErrorCode(error, 'WORKFLOW_FAILED')
  await env.DB.prepare(`UPDATE ai_jobs SET status='failed',last_error_code=?,last_error_message=?,completed_at=?,updated_at=?
    WHERE id=? AND workflow_id=? AND status='processing'`).bind(code,safeErrorMessage(error),now,now,jobId,workflowId).run()
  safeLog('error', 'ai_workflow_failed', { jobId, code })
}
