import { describe,expect,it } from 'vitest'
import type { PublicMediaRow } from '../gallery/media'
import { fakeEnv } from '../../test/fake'
import { semanticSearchRoute } from './discovery'

const mediaId='00000000-0000-4000-8000-000000000031'
const vectorId=`s:${mediaId}:model:generation`
const mediaRow:PublicMediaRow={ id:mediaId,media_type:'photo',mime_type:'image/jpeg',original_object_key:'originals/a.jpg',display_object_key:'display/a.webp',thumbnail_object_key:'thumbnails/a.webp',width:1200,height:900,duration_seconds:null,guest_name:null,guest_message:null,manual_alt_text:null,source:'guest',created_at:'2027-08-21T00:00:00.000Z',face_search_enabled:1,event_id:'event-solemnisation',event_slug:'solemnisation',event_name:'solemnisation',event_date:'2027-08-21',event_display_name:'Solemnisation',event_upload_enabled:0,ai_caption:'Guests near the stage.',categories_json:'[]' }

function environment(currentMapping:boolean) {
  const env=fakeEnv({
    all:(sql,bindings)=>{
      if (sql.includes('SELECT key,value FROM settings')) return [{ key:'ai_enabled',value:'true' },{ key:'semantic_search_enabled',value:'true' }]
      if (sql.includes('FROM media_semantic_vectors')) {
        const tuple=bindings.slice(0,5)
        if (JSON.stringify(tuple)!==JSON.stringify(['mock','deterministic-development-semantic','mock-v1',16,'cosine'])) return []
        return currentMapping?[{ embedding_vector_id:vectorId,media_id:mediaId }]:[]
      }
      if (sql.includes('FROM media m JOIN events')) return [mediaRow]
      return []
    },
  })
  env.MOCK_AI='true'
  env.SEMANTIC_INDEX={ query:async()=>({ count:1,matches:[{ id:vectorId,score:.91 }] }) } as unknown as Vectorize
  return env
}

const request=()=>new Request('http://api.test/api/explore/search',{ method:'POST',headers:{ Origin:'http://localhost:5173','Content-Type':'application/json' },body:JSON.stringify({ query:'friends by the stage' }) })

describe('semantic discovery model fencing',()=>{
  it('resolves a vector only through the current provider tuple and D1 mapping',async()=>{
    const response=await semanticSearchRoute(request(),environment(true))
    const body=await response.json() as { data:{ items:Array<{ id:string }> } }
    expect(body.data.items.map((item)=>item.id)).toEqual([mediaId])
  })

  it('omits an orphaned or obsolete Vectorize match',async()=>{
    const response=await semanticSearchRoute(request(),environment(false))
    const body=await response.json() as { data:{ items:unknown[] } }
    expect(body.data.items).toEqual([])
  })
})
