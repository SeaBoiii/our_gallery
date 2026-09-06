import type { EmbeddedFace, FaceEmbeddingProvider } from './FaceEmbeddingProvider'

const MOCK_DIMENSIONS = 16

async function deterministicVector(image: ArrayBuffer, faceIndex: number) {
  const suffix = new Uint8Array([faceIndex])
  const source = new Uint8Array(image.byteLength + suffix.byteLength)
  source.set(new Uint8Array(image))
  source.set(suffix, image.byteLength)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source))
  const vector = Array.from(digest.slice(0, MOCK_DIMENSIONS), (value) => (value - 127.5) / 127.5)
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => value / magnitude)
}

export class MockFaceEmbeddingProvider implements FaceEmbeddingProvider {
  readonly provider = 'mock'
  readonly model = 'deterministic-development-face'
  readonly modelVersion = 'mock-v1'
  readonly dimensions = MOCK_DIMENSIONS
  readonly metric = 'cosine' as const

  async analyseImage(image: ArrayBuffer, _mimeType: string): Promise<EmbeddedFace[]> {
    const marker = new TextDecoder().decode(image.slice(0, Math.min(image.byteLength, 64)))
    if (marker.includes('NO_FACE')) return []
    const count = marker.includes('MULTI_FACE') ? 2 : 1
    const quality = marker.includes('LOW_QUALITY') ? 0.2 : 0.92
    return Promise.all(Array.from({ length: count }, async (_, faceIndex) => ({
      bounds: count === 1
        ? { x: 0.2, y: 0.12, width: 0.6, height: 0.72 }
        : { x: 0.08 + faceIndex * 0.48, y: 0.18, width: 0.4, height: 0.58 },
      quality,
      embedding: await deterministicVector(image, faceIndex),
    })))
  }
}

