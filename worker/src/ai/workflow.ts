import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../env'
import {
  beginAnalysis,
  deleteMediaAi,
  failJob,
  finishAnalysis,
  indexFaces,
  indexSemantic,
  markTaskFailure,
  persistVisionAnalysis,
  purgeFaces,
  runVisionAnalysis,
} from './pipeline'
import type { MediaAnalysisParams } from './types'

const providerStep = { retries: { limit: 4, delay: '1 minute' as const }, timeout: '5 minutes' as const }

export class MediaAnalysisWorkflow extends WorkflowEntrypoint<Env, MediaAnalysisParams> {
  async run(event: Readonly<WorkflowEvent<MediaAnalysisParams>>, step: WorkflowStep) {
    const params = event.payload
    try {
      if (params.type === 'DELETE_MEDIA_AI') {
        if (params.mediaId) await step.do('delete media AI records and vectors', providerStep, () => deleteMediaAi(this.env, params.mediaId!, params.jobId, event.instanceId))
        await step.do('complete deletion job', () => this.completeCleanupJob(params.jobId, event.instanceId))
        return
      }
      if (params.type === 'PURGE_MEDIA_FACES' || params.type === 'PURGE_ALL_FACES') {
        await step.do('purge face vectors', providerStep, () => purgeFaces(this.env, params.type === 'PURGE_MEDIA_FACES' ? params.mediaId : null, params.jobId, event.instanceId))
        await step.do('complete face purge job', () => this.completeCleanupJob(params.jobId, event.instanceId))
        return
      }
      const media = await step.do('verify media eligibility', () => beginAnalysis(this.env, params, event.instanceId))
      if (!media || !params.mediaId) return

      try {
        const vision = await step.do('analyse gallery derivative', providerStep, () => runVisionAnalysis(this.env, media, params.jobId, event.instanceId))
        if (vision) await step.do('persist caption and categories', () => persistVisionAnalysis(this.env, media.id, vision, params.jobId, event.instanceId))
      } catch (error) {
        await step.do('record vision failure', () => Promise.all([
          markTaskFailure(this.env, media.id, 'categorisation', error, params.jobId, event.instanceId),
          markTaskFailure(this.env, media.id, 'caption', error, params.jobId, event.instanceId),
        ]).then(() => undefined))
      }

      try { await step.do('index semantic memory', providerStep, () => indexSemantic(this.env, media, params.jobId, event.instanceId)) }
      catch (error) { await step.do('record semantic failure', () => markTaskFailure(this.env, media.id, 'semantic', error, params.jobId, event.instanceId)) }

      try { await step.do('index detected faces', providerStep, () => indexFaces(this.env, media, params.jobId, event.instanceId)) }
      catch (error) { await step.do('record face failure', () => markTaskFailure(this.env, media.id, 'face', error, params.jobId, event.instanceId)) }

      await step.do('finalise independent AI statuses', () => finishAnalysis(this.env, params.jobId, media.id, event.instanceId))
    } catch (error) {
      await failJob(this.env, params.jobId, event.instanceId, error)
      throw error
    }
  }

  private async completeCleanupJob(jobId: string, workflowId: string) {
    const now = new Date().toISOString()
    await this.env.DB.prepare(`UPDATE ai_jobs SET status='complete',completed_at=?,updated_at=?,last_error_code=NULL,last_error_message=NULL
      WHERE id=? AND workflow_id=? AND status='processing'`)
      .bind(now, now, jobId, workflowId).run()
  }
}
