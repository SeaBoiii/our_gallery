import { describe, expect, it } from 'vitest'
import { parseAndSanitizeVisionAnalysis, visionAnalysisSchema } from './analysisSchema'

const valid = {
  caption:'Guests posing beside the decorated wedding stage.',
  categories:[{ name:'Guests',confidence:.92 },{ name:'Guests',confidence:.7 }],
  scene:'indoor wedding reception',objects:['flowers','stage'],quality:{ blur:'low',brightness:'good' },
}

describe('vision output validation', () => {
  it('deduplicates categories and strips unexpected keys', () => {
    const result=parseAndSanitizeVisionAnalysis({ ...valid,unexpected:'discard',quality:{...valid.quality,religion:'never'} },'Reception')
    expect(result.categories).toEqual([{ name:'Guests',confidence:.7 }])
    expect(result).not.toHaveProperty('unexpected')
    expect(result.quality).not.toHaveProperty('religion')
  })

  it('replaces sensitive prose and drops sensitive objects', () => {
    const result=parseAndSanitizeVisionAnalysis({ ...valid,caption:'A religious group at the stage.',scene:'ethnicity gathering',objects:['flowers','gender'] },'Reception')
    expect(result.caption).toBe('A wedding memory from Reception.')
    expect(result.scene).toBe('wedding celebration')
    expect(result.objects).toEqual(['flowers'])
  })

  it.each([
    'Asian guests standing near the stage.',
    'A Muslim family smiling together.',
    'An elderly woman in a wheelchair.',
    'A happy husband and wife at the entrance.',
    'Aleem poses beside the table.',
    'A 24-year-old guest holds flowers.',
  ])('falls back instead of persisting sensitive inference: %s', (caption) => {
    expect(parseAndSanitizeVisionAnalysis({ ...valid,caption },'Reception').caption).toBe('A wedding memory from Reception.')
  })

  it('rejects malformed categories and confidence values', () => {
    expect(()=>visionAnalysisSchema.parse({ ...valid,categories:[{ name:'Unknown sensitive label',confidence:2 }] })).toThrow()
  })
})
