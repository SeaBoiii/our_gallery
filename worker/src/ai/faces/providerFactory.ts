import type { Env } from '../../env'
import { AiProviderError } from '../providers/errors'
import type { FaceDistanceMetric, FaceEmbeddingProvider } from './FaceEmbeddingProvider'
import { ExternalFaceEmbeddingProvider } from './externalFaceProvider'
import { MockFaceEmbeddingProvider } from './mockFaceProvider'

export function getFaceProvider(env: Env): FaceEmbeddingProvider | null {
  const provider = env.FACE_PROVIDER?.trim()
  if (!provider) return null
  if (provider === 'mock') {
    if (env.ENVIRONMENT !== 'development' || env.MOCK_AI !== 'true') throw new AiProviderError('MOCK_AI_FORBIDDEN', 'Mock face processing is disabled.', false)
    return new MockFaceEmbeddingProvider()
  }
  if (provider !== 'external') throw new AiProviderError('FACE_PROVIDER_UNKNOWN', 'The configured face provider is not supported.', false)
  const dimensions = Number(env.FACE_EMBEDDING_DIMENSIONS)
  const metric = env.FACE_DISTANCE_METRIC as FaceDistanceMetric
  if (!env.FACE_PROVIDER_ENDPOINT || !env.FACE_PROVIDER_API_KEY || !env.FACE_EMBEDDING_MODEL || !env.FACE_EMBEDDING_MODEL_VERSION ||
    !Number.isInteger(dimensions) || dimensions < 1 || !['cosine','euclidean','dot-product'].includes(metric)) return null
  return new ExternalFaceEmbeddingProvider({
    endpoint: env.FACE_PROVIDER_ENDPOINT,
    apiKey: env.FACE_PROVIDER_API_KEY,
    model: env.FACE_EMBEDDING_MODEL,
    modelVersion: env.FACE_EMBEDDING_MODEL_VERSION,
    dimensions,
    metric,
  })
}

