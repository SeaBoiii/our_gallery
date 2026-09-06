export const AI_ANALYSIS_VERSION = 1
export const AI_MESSAGE_SCHEMA_VERSION = 2

export type AiJobType =
  | 'ANALYSE_MEDIA'
  | 'REPROCESS_MEDIA'
  | 'DELETE_MEDIA_AI'
  | 'PURGE_MEDIA_FACES'
  | 'PURGE_ALL_FACES'

export type AiQueueMessage = {
  schemaVersion: typeof AI_MESSAGE_SCHEMA_VERSION
  jobId: string
  type: AiJobType
  mediaId: string | null
  analysisVersion: number
  dispatchToken: string
}

export type MediaAnalysisParams = AiQueueMessage

export type WorkersAiBinding = {
  run(model: string, input: unknown, options?: Record<string, unknown>): Promise<unknown>
}

export type AiJobRow = {
  id: string
  job_type: AiJobType
  media_id: string | null
  analysis_version: number
  status: 'queued' | 'dispatched' | 'processing' | 'complete' | 'partial' | 'failed' | 'dismissed' | 'cancelled'
  attempt_count: number
}
