export type FaceDistanceMetric = 'cosine' | 'euclidean' | 'dot-product'

export type NormalizedFaceBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type EmbeddedFace = {
  bounds: NormalizedFaceBounds
  quality: number | null
  embedding: number[]
}

export type FaceEmbeddingProvider = {
  readonly provider: string
  readonly model: string
  readonly modelVersion: string
  readonly dimensions: number
  readonly metric: FaceDistanceMetric
  analyseImage(image: ArrayBuffer, mimeType: string): Promise<EmbeddedFace[]>
}

export function validateEmbedding(provider: FaceEmbeddingProvider, embedding: number[]) {
  return embedding.length === provider.dimensions && embedding.every(Number.isFinite)
}

