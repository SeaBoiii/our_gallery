import { describe,expect,it } from 'vitest'
import { fakeEnv } from '../../test/fake'
import { builderArchiveChecksumsRoute,builderArchiveJobRoute,builderArchivePartRoute,builderArchivePlanRoute,builderCompleteArchiveRoute } from './adminArchive'

const jobId='00000000-0000-4000-8000-000000000010'
const token='archive-builder-token-that-is-long-enough'
const request=(path:string,body?:unknown,authorization=token)=>new Request(`http://api.test${path}`,{ method:body?'POST':'GET',headers:{ Authorization:`Bearer ${authorization}`,...(body?{ 'Content-Type':'application/json' }: {}) },body:body?JSON.stringify(body):undefined })

describe('archive builder integrity',()=>{
  it('requires a dedicated builder credential',async()=>{
    const env=fakeEnv();env.ARCHIVE_BUILDER_TOKEN=token
    await expect(builderArchiveJobRoute(request(`/api/archive-builder/jobs/${jobId}`,undefined,'wrong-token-that-is-also-long-enough'),env,jobId)).rejects.toMatchObject({ code:'ARCHIVE_BUILDER_REQUIRED' })
  })

  it('refuses completion when active inventory has no registered ZIP part',async()=>{
    const env=fakeEnv({
      first:(sql)=>{
        if (sql.includes('SELECT id FROM archive_jobs WHERE id=? AND lease_owner')) return { id:jobId }
        if (sql.includes('ai.sha256 IS NULL')) return { count:0 }
        if (sql.includes('processed_at IS NOT NULL')) return { count:0 }
        if (sql.includes('COUNT(*) AS files')) return { files:1,bytes:100 }
        if (sql.includes('ai.archive_filename IS NULL')) return { count:1 }
        if (sql.includes('archive_parts ap WHERE')) return { count:0 }
        if (sql.includes('COUNT(*) AS count FROM (')) return { count:0 }
        if (sql.includes("COUNT(*) AS count FROM archive_parts")) return { count:0 }
        return null
      },
      all:(sql)=>sql.includes('FROM archive_artifacts')?[
        { kind:'manifest_json',object_key:'a' },{ kind:'manifest_csv',object_key:'b' },{ kind:'checksums',object_key:'c' },{ kind:'readme',object_key:'d' },
      ]:[],
    })
    env.ARCHIVE_BUILDER_TOKEN=token
    await expect(builderCompleteArchiveRoute(request(`/api/archive-builder/jobs/${jobId}/complete`,{ builderId:'builder:test',leaseGeneration:1 }),env,jobId)).rejects.toMatchObject({ code:'ARCHIVE_PARTS_INCOMPLETE' })
  })

  it('turns a zero-row guarded completion into a deletion conflict when the lease is still current',async()=>{
    let completionSql=''
    const env=fakeEnv({
      first:(sql)=>{
        if (sql.includes('SELECT id FROM archive_jobs WHERE id=? AND lease_owner')) return { id:jobId }
        if (sql.includes('ai.sha256 IS NULL')) return { count:0 }
        if (sql.includes('processed_at IS NOT NULL')) return { count:0 }
        if (sql.includes('COUNT(*) AS files')) return { files:1,bytes:100 }
        if (sql.includes('ai.archive_filename IS NULL')) return { count:0 }
        if (sql.includes('archive_parts ap WHERE')) return { count:0 }
        if (sql.includes('COUNT(*) AS count FROM (')) return { count:0 }
        if (sql.includes("COUNT(*) AS count FROM archive_parts")) return { count:1 }
        return null
      },
      all:(sql)=>sql.includes('FROM archive_artifacts')?[
        { kind:'manifest_json',object_key:'a' },{ kind:'manifest_csv',object_key:'b' },{ kind:'checksums',object_key:'c' },{ kind:'readme',object_key:'d' },
      ]:[],
      run:(sql)=>{
        if (sql.includes("SET status='complete'")) { completionSql=sql;return { changes:0 } }
        return { changes:1 }
      },
    })
    env.ARCHIVE_BUILDER_TOKEN=token
    await expect(builderCompleteArchiveRoute(request(`/api/archive-builder/jobs/${jobId}/complete`,{ builderId:'builder:test',leaseGeneration:2 }),env,jobId)).rejects.toMatchObject({ code:'ARCHIVE_MEDIA_DELETED_AFTER_BUILD' })
    expect(completionSql).toContain('NOT EXISTS')
    expect(completionSql).toContain("m.status IN ('deleting','deleted','expired')")
  })

  it('rejects plan and checksum payloads that exceed the safe D1 query budget',async()=>{
    const env=fakeEnv();env.ARCHIVE_BUILDER_TOKEN=token
    const items=Array.from({ length:16 },(_,index)=>({
      mediaId:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
      archiveFilename:`21-Aug-Solemnisation/originals/${index}.jpg`,
      sha256:'a'.repeat(64),partNumber:1,
    }))
    await expect(builderArchivePlanRoute(request(`/api/archive-builder/jobs/${jobId}/plan`,{ builderId:'builder:test',leaseGeneration:1,eventId:'event-solemnisation',partNumber:1,planSha256:'b'.repeat(64),fileCount:16,items }),env,jobId)).rejects.toMatchObject({ code:'INVALID_ARCHIVE_PLAN' })
    await expect(builderArchiveChecksumsRoute(request(`/api/archive-builder/jobs/${jobId}/checksums`,{ builderId:'builder:test',leaseGeneration:1,items }),env,jobId)).rejects.toMatchObject({ code:'INVALID_ARCHIVE_CHECKSUMS' })
  })

  it('registers a verified uploaded part from an older object generation under the current lease fence',async()=>{
    let registrationSql=''
    const env=fakeEnv({
      first:(sql)=>{
        if (sql.includes('SELECT id FROM archive_jobs WHERE id=? AND lease_owner')) return { id:jobId }
        if (sql.includes('SELECT plan_sha256,file_count')) return { plan_sha256:'c'.repeat(64),file_count:1 }
        if (sql.includes('MIN(CASE')) return { event_id:'event-solemnisation',event_slug:'solemnisation',count:1,ready:1 }
        if (sql.includes('ai.assigned_part')) return { count:1 }
        return null
      },
      run:(sql)=>{ if (sql.includes('INSERT INTO archive_parts')) registrationSql=sql;return { changes:1 } },
    })
    env.ARCHIVE_BUILDER_TOKEN=token
    env.MEDIA={ ...env.MEDIA,head:async()=>({ size:123 }) } as unknown as R2Bucket
    const filename='AN-Wedding-Solemnisation-Part001.zip'
    const objectKey=`archives/${jobId}/parts/solemnisation/${'c'.repeat(64)}/lease-1/${filename}`
    const response=await builderArchivePartRoute(request(`/api/archive-builder/jobs/${jobId}/parts`,{
      builderId:'builder:test',leaseGeneration:2,objectLeaseGeneration:1,eventId:'event-solemnisation',partNumber:1,
      objectKey,filename,sizeBytes:123,sha256:'d'.repeat(64),planSha256:'c'.repeat(64),fileCount:1,
    }),env,jobId)
    expect(response.status).toBe(200)
    expect(registrationSql).toContain('FROM archive_jobs aj')
    expect(registrationSql).toContain('aj.lease_generation=?')
  })
})
