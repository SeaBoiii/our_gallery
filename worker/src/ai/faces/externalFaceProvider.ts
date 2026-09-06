import { z } from 'zod'
import { AiProviderError } from '../providers/errors'
import type { EmbeddedFace, FaceDistanceMetric, FaceEmbeddingProvider } from './FaceEmbeddingProvider'
import { validateEmbedding } from './FaceEmbeddingProvider'

const faceResponseSchema = z.object({
  faces: z.array(z.object({
    bounds: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    }),
    quality: z.number().min(0).max(1).nullable().optional(),
    embedding: z.array(z.number().finite()),
  })).max(100),
}).strip()

type ExternalFaceProviderOptions = {
  endpoint: string
  apiKey: string
  model: string
  modelVersion: string
  dimensions: number
  metric: FaceDistanceMetric
}

/**
 * Vendor-neutral adapter contract: POST the original image bytes to the exact
 * configured HTTPS endpoint and expect `{ faces: [{ bounds, quality,
 * embedding }] }`. Production enablement is conditional on a separately
 * verified no-retention agreement with the selected provider.
 */
export class ExternalFaceEmbeddingProvider implements FaceEmbeddingProvider {
  readonly provider = 'external'
  readonly model: string
  readonly modelVersion: string
  readonly dimensions: number
  readonly metric: FaceDistanceMetric
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(options: ExternalFaceProviderOptions) {
    this.endpoint = options.endpoint
    this.apiKey = options.apiKey
    this.model = options.model
    this.modelVersion = options.modelVersion
    this.dimensions = options.dimensions
    this.metric = options.metric
  }

  async analyseImage(image: ArrayBuffer, mimeType: string): Promise<EmbeddedFace[]> {
    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': mimeType,
          'X-Face-Operation': 'detect-and-embed',
          'X-Face-Model': this.model,
          'X-Face-Model-Version': this.modelVersion,
          'X-Data-Retention': 'none',
        },
        body: image,
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new AiProviderError('FACE_PROVIDER_UNAVAILABLE', 'The face-search provider is temporarily unavailable.')
    }
    if (!response.ok) throw new AiProviderError('FACE_PROVIDER_REJECTED', 'The face-search provider could not process this image.', response.status >= 500 || response.status === 429)
    const parsed = faceResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new AiProviderError('FACE_PROVIDER_INVALID_RESPONSE', 'The face-search provider returned an invalid response.')
    if (parsed.data.faces.some((face) => !validateEmbedding(this, face.embedding))) {
      throw new AiProviderError('FACE_DIMENSION_MISMATCH', 'The face provider response does not match the configured index dimensions.', false)
    }
    return parsed.data.faces.map((face) => ({ bounds: face.bounds, quality: face.quality ?? null, embedding: face.embedding }))
  }
}

