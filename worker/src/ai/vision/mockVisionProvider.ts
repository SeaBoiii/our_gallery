import type { VisionAnalysisProvider, VisionContext } from './VisionAnalysisProvider'
import type { VisionAnalysis } from './analysisSchema'

const variants: Array<Pick<VisionAnalysis, 'caption' | 'categories' | 'scene' | 'objects'>> = [
  { caption: 'Guests sharing a candid moment near the decorated wedding stage.', categories: [{ name: 'Candid', confidence: 0.93 }, { name: 'Guests', confidence: 0.88 }, { name: 'Stage / Pelamin', confidence: 0.81 }], scene: 'indoor wedding reception', objects: ['flowers', 'wedding stage'] },
  { caption: 'A group portrait captured during the wedding celebration.', categories: [{ name: 'Group Photo', confidence: 0.95 }, { name: 'Friends', confidence: 0.84 }], scene: 'wedding venue', objects: ['floral decor'] },
  { caption: 'Wedding details arranged carefully at the celebration venue.', categories: [{ name: 'Wedding Details', confidence: 0.94 }, { name: 'Decor', confidence: 0.9 }], scene: 'decorated wedding venue', objects: ['flowers', 'table setting'] },
]

export class MockVisionAnalysisProvider implements VisionAnalysisProvider {
  readonly provider = 'mock'
  readonly model = 'deterministic-development-vision'
  readonly modelVersion = 'mock-v1'

  async analyse(image: ArrayBuffer, _mimeType: string, _context: VisionContext): Promise<VisionAnalysis> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', image))
    const selected = variants[digest[0] % variants.length]
    return { ...selected, categories: selected.categories.map((category) => ({ ...category })), objects: [...selected.objects], quality: { blur: 'low', brightness: 'good' } }
  }
}

