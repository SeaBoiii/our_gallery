import { describe,expect,it,vi } from 'vitest'
import type { WorkersAiBinding } from '../types'
import { WorkersAiVisionProvider } from './workersAiVisionProvider'

describe('WorkersAiVisionProvider',()=>{
  it('sends the image as a chat-completions image_url content part',async()=>{
    const run=vi.fn().mockResolvedValue({ choices:[{ message:{ content:JSON.stringify({
      caption:'Guests standing beside the decorated stage.',
      categories:[{ name:'Guests',confidence:.9 }],
      scene:'indoor wedding reception',
      objects:['flowers'],
      quality:{ blur:'low',brightness:'good' },
    }) } }] })
    const provider=new WorkersAiVisionProvider({ run } as WorkersAiBinding,'@cf/google/gemma-4-26b-a4b-it','test-version')
    await provider.analyse(new Uint8Array([0xff,0xd8,0xff]).buffer,'image/jpeg',{ eventName:'Reception',eventDate:'2027-08-22',mediaType:'photo' })

    expect(run).toHaveBeenCalledOnce()
    const input=run.mock.calls[0][1]
    expect(input).not.toHaveProperty('image')
    expect(input.messages[1]).toMatchObject({ role:'user',content:[
      { type:'text' },
      { type:'image_url',image_url:{ url:expect.stringMatching(/^data:image\/jpeg;base64,/),detail:'high' } },
    ] })
    expect(input.store).toBe(false)
  })
})
