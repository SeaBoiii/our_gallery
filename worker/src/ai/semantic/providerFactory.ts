import type { Env } from '../../env'
import { AiProviderError } from '../providers/errors'
import type { SemanticEmbeddingProvider } from './SemanticEmbeddingProvider'

class MockSemanticEmbeddingProvider implements SemanticEmbeddingProvider {
  readonly provider = 'mock'
  readonly model = 'deterministic-development-semantic'
  readonly modelVersion = 'mock-v1'
  readonly dimensions = 16
  readonly metric = 'cosine' as const

  async embed(text: string) {
    const source = new TextEncoder().encode(text.normalize('NFKC').toLocaleLowerCase('en'))
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source))
    const vector = Array.from(digest.slice(0, this.dimensions), (value) => (value - 127.5) / 127.5)
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
    return vector.map((value) => value / magnitude)
  }
}

class WorkersAiSemanticEmbeddingProvider implements SemanticEmbeddingProvider {
  readonly provider = 'cloudflare-workers-ai'
  readonly metric = 'cosine' as const

  constructor(
    private readonly ai: NonNullable<Env['AI']>,
    readonly model: string,
    readonly modelVersion: string,
    readonly dimensions: number,
  ) {}

  async embed(text: string) {
    let result: unknown
    try { result = await this.ai.run(this.model, { queries: [text] }) }
    catch { throw new AiProviderError('SEMANTIC_PROVIDER_UNAVAILABLE', 'Memory search is temporarily unavailable.') }
    const data = result && typeof result === 'object' ? (result as { data?: unknown }).data : null
    const vector = Array.isArray(data) && Array.isArray(data[0]) ? data[0] as unknown[] : null
    if (!vector || vector.length !== this.dimensions || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new AiProviderError('SEMANTIC_DIMENSION_MISMATCH', 'The semantic embedding does not match the configured Vectorize index.', false)
    }
    return vector as number[]
  }
}

export function getSemanticProvider(env: Env): SemanticEmbeddingProvider | null {
  if (env.MOCK_AI === 'true' && env.ENVIRONMENT === 'development') return new MockSemanticEmbeddingProvider()
  if (!env.AI) return null
  return new WorkersAiSemanticEmbeddingProvider(
    env.AI,
    env.SEMANTIC_MODEL || '@cf/qwen/qwen3-embedding-0.6b',
    env.SEMANTIC_MODEL_VERSION || '2025-06',
    Number(env.SEMANTIC_EMBEDDING_DIMENSIONS || 1024),
  )
}

