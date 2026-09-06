import type { EventMode, PublicCapabilities } from '../../shared/contracts'
import type { Env } from './env'

export type OperationalSettings = {
  eventMode: EventMode
  uploadsEnabled: boolean
  aiEnabled: boolean
  faceSearchEnabled: boolean
  autoAiProcessing: boolean
  semanticSearchEnabled: boolean
  aiProcessingPaused: boolean
}

const booleanValue = (value: string | undefined, fallback: boolean) => value === undefined ? fallback : value === 'true'

export async function readSettingValues(env: Env) {
  const result = await env.DB.prepare('SELECT key,value FROM settings').all<{ key: string; value: string }>()
  return new Map(result.results.map((row) => [row.key, row.value]))
}

export function operationalSettingsFrom(values: Map<string, string>): OperationalSettings {
  const candidateMode = values.get('event_mode')
  const eventMode: EventMode = candidateMode === 'post-wedding' || candidateMode === 'archive' ? candidateMode : 'live'
  return {
    eventMode,
    uploadsEnabled: booleanValue(values.get('uploads_enabled'), true),
    aiEnabled: booleanValue(values.get('ai_enabled'), true),
    faceSearchEnabled: booleanValue(values.get('face_search_enabled'), false),
    autoAiProcessing: booleanValue(values.get('auto_ai_processing'), true),
    semanticSearchEnabled: booleanValue(values.get('semantic_search_enabled'), true),
    aiProcessingPaused: booleanValue(values.get('ai_processing_paused'), false),
  }
}

export async function readOperationalSettings(env: Env) {
  return operationalSettingsFrom(await readSettingValues(env))
}

export function uploadsAllowed(settings: OperationalSettings) {
  return settings.eventMode !== 'archive' && settings.uploadsEnabled
}

export async function publicCapabilities(env: Env): Promise<PublicCapabilities> {
  const settings = await readOperationalSettings(env)
  const activeCalibration = settings.faceSearchEnabled && Boolean(env.FACE_INDEX) && Boolean(env.FACE_PROVIDER)
    ? await env.DB.prepare(`SELECT id FROM face_calibrations WHERE active=1 AND provider=? AND model=? AND model_version=? AND dimensions=? AND distance_metric=? LIMIT 1`)
      .bind(env.FACE_PROVIDER, env.FACE_EMBEDDING_MODEL || '', env.FACE_EMBEDDING_MODEL_VERSION || '', Number(env.FACE_EMBEDDING_DIMENSIONS || 0), env.FACE_DISTANCE_METRIC || '').first<{ id: string }>()
    : null
  return {
    eventMode: settings.eventMode,
    uploadsEnabled: uploadsAllowed(settings),
    liveWallEnabled: settings.eventMode === 'live',
    galleryEnabled: true,
    findMeEnabled: settings.eventMode !== 'archive' && settings.aiEnabled && settings.faceSearchEnabled && Boolean(activeCalibration),
    semanticSearchEnabled: settings.eventMode !== 'archive' && settings.aiEnabled && settings.semanticSearchEnabled && Boolean(env.AI && env.SEMANTIC_INDEX),
    categoryExploreEnabled: true,
    archiveAvailable: settings.eventMode !== 'live',
  }
}
