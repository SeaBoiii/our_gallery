import { describe, expect, it } from 'vitest'
import { secureValueHash } from '../security/hash'
import { completeUploadRoute, prepareUploadsRoute, refreshUploadRoute } from './uploads'
import { fakeEnv } from '../../test/fake'

const session = '52d0b802-1bee-48be-bb11-d8a2331f9e09'
const headers = { Origin:'http://localhost:5173','X-Gallery-Session':session,'Content-Type':'application/json' }

describe('upload routes', () => {
  it('prepares a direct-to-R2 upload', async () => {
    const env = fakeEnv({
      first: (sql) => {
        if (sql.includes('INSERT INTO rate_limits')) return { count:1 }
        if (sql.includes("key = 'uploads_enabled'")) return { value:'true' }
        if (sql.includes('FROM events WHERE slug')) return { id:'event-solemnisation',slug:'solemnisation',event_date:'2027-08-21',display_name:'Solemnisation',upload_enabled:1 }
        return null
      },
    })
    const payload = { requestId:crypto.randomUUID(),eventSlug:'solemnisation',turnstileToken:'development-bypass',files:[{ clientId:crypto.randomUUID(),filename:'memory.jpg',mimeType:'image/jpeg',size:12,mediaType:'photo',fingerprint:'a'.repeat(64),variants:[] }] }
    const response = await prepareUploadsRoute(new Request('https://api.test/api/uploads/prepare',{ method:'POST',headers,body:JSON.stringify(payload) }),env)
    expect(response.status).toBe(201)
    const body = await response.json() as { ok:boolean;data:{uploads:Array<{original:{url:string}}>}}
    expect(body.ok).toBe(true)
    const target = new URL(body.data.uploads[0].original.url)
    expect(target.hostname).toContain('r2.cloudflarestorage.com')
    expect(decodeURIComponent(target.pathname)).toContain('/test-bucket/staging/2027-08-21/')
  })

  it('allows only one in-flight preparation claim for a request ID', async () => {
    const base = fakeEnv()
    const sessionHash = await secureValueHash(base,session)
    let claimedIntent = ''
    const env = fakeEnv({
      first: (sql) => {
        if (sql.includes('INSERT INTO rate_limits')) return { count:1 }
        if (sql.includes("key = 'uploads_enabled'")) return { value:'true' }
        if (sql.includes('FROM events WHERE slug')) return { id:'event-solemnisation',slug:'solemnisation',event_date:'2027-08-21',display_name:'Solemnisation',upload_enabled:1 }
        if (sql.includes('FROM upload_requests WHERE id')) return { session_hash:sessionHash,intent_hash:claimedIntent,status:'preparing',expires_at:new Date(Date.now()+60_000).toISOString() }
        return null
      },
      run: (sql,bindings) => {
        if (sql.includes('INSERT INTO upload_requests')) { claimedIntent = String(bindings[2]); return { changes:0 } }
        return { changes:1 }
      },
    })
    const payload = { requestId:crypto.randomUUID(),eventSlug:'solemnisation',turnstileToken:'development-bypass',files:[{ clientId:crypto.randomUUID(),filename:'memory.jpg',mimeType:'image/jpeg',size:12,mediaType:'photo',fingerprint:'a'.repeat(64),variants:[] }] }
    const operation = prepareUploadsRoute(new Request('https://api.test/api/uploads/prepare',{ method:'POST',headers,body:JSON.stringify(payload) }),env)
    await expect(operation).rejects.toMatchObject({ code:'REQUEST_IN_PROGRESS', retryable:true })
  })

  it('never re-signs a terminal idempotency row', async () => {
    const sessionHash = await secureValueHash(fakeEnv(),session)
    const requestId = crypto.randomUUID()
    const payload = { requestId,eventSlug:'solemnisation',turnstileToken:'development-bypass',files:[{ clientId:crypto.randomUUID(),filename:'memory.jpg',mimeType:'image/jpeg',size:12,mediaType:'photo',fingerprint:'a'.repeat(64),variants:[] }] }
    const env = fakeEnv({
      first: (sql) => {
        if (sql.includes('INSERT INTO rate_limits')) return { count:1 }
        if (sql.includes("key = 'uploads_enabled'")) return { value:'true' }
        if (sql.includes('FROM events WHERE slug')) return { id:'event-solemnisation',slug:'solemnisation',event_date:'2027-08-21',display_name:'Solemnisation',upload_enabled:1 }
        return null
      },
      all: (sql) => sql.includes('m.request_id = ?') ? [{ request_id:requestId,client_id:payload.files[0].clientId,session_hash:sessionHash,status:'approved',event_slug:'solemnisation',intent_hash:'terminal' }] : [],
    })
    const operation = prepareUploadsRoute(new Request('https://api.test/api/uploads/prepare',{ method:'POST',headers,body:JSON.stringify(payload) }),env)
    await expect(operation).rejects.toMatchObject({ code:'REQUEST_ID_CONFLICT' })
  })

  it('refuses refreshed PUT authority for an approved row', async () => {
    const env = fakeEnv()
    const sessionHash = await secureValueHash(env,session)
    env.DB = fakeEnv({ first: (sql) => sql.includes('SELECT m.*, e.event_date') ? { id:crypto.randomUUID(),session_hash:sessionHash,status:'approved' } : null }).DB
    const operation = refreshUploadRoute(new Request('https://api.test/api/uploads/id/refresh',{ method:'POST',headers,body:'{}' }),env,crypto.randomUUID())
    await expect(operation).rejects.toMatchObject({ code:'INVALID_UPLOAD_STATE' })
  })

  it('does not complete when the R2 original is missing', async () => {
    const env = fakeEnv()
    const sessionHash = await secureValueHash(env,session)
    env.DB = fakeEnv({ first: (sql) => sql.includes('SELECT m.*, e.event_date') ? { id:crypto.randomUUID(),request_id:crypto.randomUUID(),client_id:crypto.randomUUID(),event_id:'event-solemnisation',event_date:'2027-08-21',media_type:'photo',mime_type:'image/jpeg',original_object_key:'originals/test.jpg',display_object_key:null,thumbnail_object_key:null,size_bytes:12,display_size_bytes:0,thumbnail_size_bytes:0,session_hash:sessionHash,status:'uploading',derivative_status:'unavailable' } : null }).DB
    const responsePromise = completeUploadRoute(new Request('https://api.test/api/uploads/complete',{ method:'POST',headers,body:JSON.stringify({ uploadedVariants:[],derivativeStatus:'unavailable' }) }),env,crypto.randomUUID())
    await expect(responsePromise).rejects.toMatchObject({ code:'ORIGINAL_MISSING' })
  })

  it('authoritatively verifies every expected derivative instead of trusting the completion claim', async () => {
    const base = fakeEnv()
    const sessionHash = await secureValueHash(base,session)
    const mediaId = crypto.randomUUID()
    const row = {
      id:mediaId,request_id:crypto.randomUUID(),client_id:crypto.randomUUID(),event_id:'event-solemnisation',event_date:'2027-08-21',event_slug:'solemnisation',media_type:'photo',mime_type:'image/jpeg',
      staging_original_object_key:'staging/test/original.jpg',staging_display_object_key:'staging/test/display.webp',staging_thumbnail_object_key:'staging/test/thumbnail.webp',
      original_object_key:'originals/test.jpg',display_object_key:'display/test.webp',thumbnail_object_key:'thumbnails/test.webp',original_filename:'memory.jpg',fingerprint:'a'.repeat(64),intent_hash:'intent',
      size_bytes:12,display_size_bytes:12,thumbnail_size_bytes:12,session_hash:sessionHash,status:'uploading',derivative_status:'pending',upload_expires_at:new Date(Date.now()+60_000).toISOString(),last_put_expires_at:new Date(Date.now()+60_000).toISOString(),created_at:new Date().toISOString(),
    }
    let finalizedDerivative = ''
    const env = fakeEnv({
      first: (sql) => {
        if (sql.includes('SELECT m.*, e.event_date')) return row
        if (sql.includes('INSERT INTO rate_limits')) return { count:1 }
        if (sql.includes("key = 'auto_approve_uploads'")) return { value:'false' }
        return null
      },
      run: (sql, bindings) => {
        if (sql.includes('UPDATE media SET status = ?, derivative_status')) finalizedDerivative = String(bindings[1])
        return { changes:1 }
      },
    })
    const bytes = new Map<string,Uint8Array>([
      [row.original_object_key,new Uint8Array([0xff,0xd8,0xff,0,0,0,0,0,0,0,0,0])],
      [row.display_object_key,new TextEncoder().encode('RIFF0000WEBP')],
      [row.thumbnail_object_key,new TextEncoder().encode('RIFF0000WEBP')],
    ])
    env.MEDIA = {
      head: async (key: string) => bytes.has(key) ? { size:bytes.get(key)!.byteLength,httpMetadata:{ contentType:key.endsWith('.jpg') ? 'image/jpeg' : 'image/webp' },httpEtag:'"verified"' } : null,
      get: async (key: string) => bytes.has(key) ? { arrayBuffer:async () => bytes.get(key)!.buffer } : null,
      delete: async () => undefined,
    } as unknown as R2Bucket
    const response = await completeUploadRoute(new Request('https://api.test/api/uploads/complete',{ method:'POST',headers,body:JSON.stringify({ uploadedVariants:[],derivativeStatus:'unavailable' }) }),env,mediaId)
    expect(response.status).toBe(200)
    expect(finalizedDerivative).toBe('ready')
    await expect(response.json()).resolves.toMatchObject({ ok:true,data:{ status:'pending' } })
  })
})
