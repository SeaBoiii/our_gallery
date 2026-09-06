import type { Env } from '../../env'
import type { VisionAnalysisProvider } from './VisionAnalysisProvider'
import { MockVisionAnalysisProvider } from './mockVisionProvider'
import { WorkersAiVisionProvider } from './workersAiVisionProvider'

export function getVisionProvider(env: Env): VisionAnalysisProvider | null {
  if (env.MOCK_AI === 'true' && env.ENVIRONMENT === 'development') return new MockVisionAnalysisProvider()
  if (!env.AI) return null
  return new WorkersAiVisionProvider(
    env.AI,
    env.VISION_MODEL || '@cf/google/gemma-4-26b-a4b-it',
    env.VISION_MODEL_VERSION || '2026-04',
  )
}

