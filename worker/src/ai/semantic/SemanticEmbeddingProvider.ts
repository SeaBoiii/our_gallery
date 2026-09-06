export type SemanticEmbeddingProvider = {
  readonly provider: string
  readonly model: string
  readonly modelVersion: string
  readonly dimensions: number
  readonly metric: 'cosine'
  embed(text: string): Promise<number[]>
}

