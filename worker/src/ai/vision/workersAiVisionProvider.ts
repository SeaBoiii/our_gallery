import type { WorkersAiBinding } from '../types'
import { AiProviderError } from '../providers/errors'
import { parseAndSanitizeVisionAnalysis, visionJsonSchema, type VisionAnalysis } from './analysisSchema'
import type { VisionAnalysisProvider, VisionContext } from './VisionAnalysisProvider'

function dataUri(image: ArrayBuffer, mimeType: string) {
  const bytes = new Uint8Array(image)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

function responseText(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const response = value as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> }
  if (typeof response.response === 'string') return response.response
  const content = response.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : null
}

export class WorkersAiVisionProvider implements VisionAnalysisProvider {
  readonly provider = 'cloudflare-workers-ai'

  constructor(
    private readonly ai: WorkersAiBinding,
    readonly model: string,
    readonly modelVersion: string,
  ) {}

  async analyse(image: ArrayBuffer, mimeType: string, context: VisionContext): Promise<VisionAnalysis> {
    const system = `Analyse one wedding-gallery image for search and accessibility. Return only the requested JSON schema. Use only the controlled categories. Do not infer or mention identity, names, age, gender, race, ethnicity, religion, nationality, disability, health, sexuality, politics, pregnancy, attractiveness, emotion, or relationships. Describe visible scene content conservatively.`
    const prompt = `Event supplied by the application: ${context.eventName} (${context.eventDate}). Media type: ${context.mediaType}. Do not infer event affiliation from appearance.`
    let result: unknown
    try {
      result = await this.ai.run(this.model, {
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUri(image, mimeType), detail: 'high' } },
            ],
          },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'wedding_media_analysis', strict: true, schema: visionJsonSchema } },
        max_completion_tokens: 500,
        temperature: 0.1,
        store: false,
      })
    } catch {
      throw new AiProviderError('VISION_PROVIDER_UNAVAILABLE', 'Wedding-memory analysis is temporarily unavailable.')
    }
    const text = responseText(result)
    if (!text) throw new AiProviderError('VISION_EMPTY_RESPONSE', 'Wedding-memory analysis returned no usable result.')
    try {
      return parseAndSanitizeVisionAnalysis(JSON.parse(text), context.eventName)
    } catch {
      throw new AiProviderError('VISION_INVALID_RESPONSE', 'Wedding-memory analysis returned invalid structured data.')
    }
  }
}
