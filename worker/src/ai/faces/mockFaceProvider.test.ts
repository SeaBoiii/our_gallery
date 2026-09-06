import { describe,expect,it } from 'vitest'
import { MockFaceEmbeddingProvider } from './mockFaceProvider'

const bytes=(value:string)=>new TextEncoder().encode(value).buffer

describe('mock face provider',()=>{
  const provider=new MockFaceEmbeddingProvider()
  it('generates deterministic normalized embeddings',async()=>{
    const first=await provider.analyseImage(bytes('same-image'),'image/jpeg')
    const second=await provider.analyseImage(bytes('same-image'),'image/jpeg')
    expect(first[0].embedding).toEqual(second[0].embedding)
    expect(first[0].embedding).toHaveLength(16)
    expect(Math.sqrt(first[0].embedding.reduce((sum,value)=>sum+value*value,0))).toBeCloseTo(1,8)
  })
  it('supports deterministic quality fixtures',async()=>{
    expect(await provider.analyseImage(bytes('NO_FACE'),'image/jpeg')).toHaveLength(0)
    expect(await provider.analyseImage(bytes('MULTI_FACE'),'image/jpeg')).toHaveLength(2)
    expect((await provider.analyseImage(bytes('LOW_QUALITY'),'image/jpeg'))[0].quality).toBe(.2)
  })
})
