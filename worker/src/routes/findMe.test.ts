import { describe,expect,it } from 'vitest'
import type { PublicMediaRow } from '../gallery/media'
import { fakeEnv } from '../../test/fake'
import { findMeSearchRoute,findMeStatusRoute } from './findMe'

const mediaId='00000000-0000-4000-8000-000000000001'
const mediaRow:PublicMediaRow={ id:mediaId,media_type:'photo',mime_type:'image/jpeg',original_object_key:'originals/a.jpg',display_object_key:'display/a.webp',thumbnail_object_key:'thumbnails/a.webp',width:1200,height:900,duration_seconds:null,guest_name:null,guest_message:null,manual_alt_text:null,source:'guest',created_at:'2027-08-21T00:00:00.000Z',face_search_enabled:1,event_id:'event-solemnisation',event_slug:'solemnisation',event_name:'solemnisation',event_date:'2027-08-21',event_display_name:'Solemnisation',event_upload_enabled:0,ai_caption:'Guests near the stage.',categories_json:'[]' }

function configuredEnv(includePublicMedia=true) {
  const env=fakeEnv({
    first:(sql)=>sql.includes('FROM face_calibrations')?{ id:'cal',provider:'mock',model:'deterministic-development-face',model_version:'mock-v1',dimensions:16,distance_metric:'cosine',match_threshold:.3,strong_match_threshold:.8 }:null,
    all:(sql,bindings)=>{
      if (sql.includes('SELECT key,value FROM settings')) return [{ key:'ai_enabled',value:'true' },{ key:'face_search_enabled',value:'true' }]
      if (sql.includes('FROM detected_faces')) return JSON.stringify(bindings.slice(0,5)) === JSON.stringify(['mock','deterministic-development-face','mock-v1',16,'cosine'])
        ? [{ embedding_vector_id:'f:one',media_id:mediaId,face_quality_score:.9 },{ embedding_vector_id:'f:two',media_id:mediaId,face_quality_score:.8 }]
        : []
      if (sql.includes('FROM media m JOIN events')) return includePublicMedia?[mediaRow]:[]
      return []
    },
  })
  env.MOCK_AI='true';env.FACE_PROVIDER='mock';env.FACE_INDEX={ query:async()=>({ count:2,matches:[{ id:'f:one',score:.91 },{ id:'f:two',score:.88 }] }) } as unknown as Vectorize
  return env
}

describe('Find Me route',()=>{
  it('requires explicit consent before provider or D1 work',async()=>{
    const request=new Request('http://api.test/api/find-me/search',{ method:'POST',headers:{ Origin:'http://localhost:5173','Content-Type':'image/jpeg' },body:'selfie' })
    await expect(findMeSearchRoute(request,configuredEnv())).rejects.toMatchObject({ code:'CONSENT_REQUIRED' })
  })
  it('falls back to bounded defaults for malformed numeric configuration',async()=>{
    const env=configuredEnv();env.FIND_ME_MAX_IMAGE_BYTES='not-a-number';env.SEARCH_SESSION_TTL_SECONDS='NaN'
    const response=await findMeStatusRoute(new Request('http://api.test/api/find-me/status'),env)
    const body=await response.json() as { data:{ maxImageBytes:number;sessionTtlSeconds:number } }
    expect(body.data).toMatchObject({ maxImageBytes:6*1024**2,sessionTtlSeconds:600 })
  })
  it('aggregates duplicate face vectors and validates media through D1',async()=>{
    const request=new Request('http://api.test/api/find-me/search',{ method:'POST',headers:{ Origin:'http://localhost:5173','Content-Type':'image/jpeg','X-Find-Me-Consent':'true' },body:'single clear selfie' })
    const response=await findMeSearchRoute(request,configuredEnv())
    const body=await response.json() as { data:{ totalMatches:number;strongMatches:Array<{ id:string }> } }
    expect(body.data.totalMatches).toBe(1)
    expect(body.data.strongMatches.map((item)=>item.id)).toEqual([mediaId])
  })
  it('omits vector matches that D1 no longer considers public',async()=>{
    const request=new Request('http://api.test/api/find-me/search',{ method:'POST',headers:{ Origin:'http://localhost:5173','Content-Type':'image/jpeg','X-Find-Me-Consent':'true' },body:'single clear selfie' })
    const response=await findMeSearchRoute(request,configuredEnv(false))
    const body=await response.json() as { data:{ totalMatches:number } }
    expect(body.data.totalMatches).toBe(0)
  })
})
