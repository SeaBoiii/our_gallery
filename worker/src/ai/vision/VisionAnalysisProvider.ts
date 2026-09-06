import type { VisionAnalysis } from './analysisSchema'

export type VisionContext = {
  eventName: string
  eventDate: string
  mediaType: 'photo' | 'video'
}

export type VisionAnalysisProvider = {
  readonly provider: string
  readonly model: string
  readonly modelVersion: string
  analyse(image: ArrayBuffer, mimeType: string, context: VisionContext): Promise<VisionAnalysis>
}

