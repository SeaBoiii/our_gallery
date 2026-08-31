import { describe, expect, it, vi } from 'vitest'
import { fakeEnv } from '../../test/fake'
import { cleanupStaleUploads } from './cleanup'

describe('scheduled object cleanup', () => {
  it('keeps a deletion retryable when R2 deletion fails', async () => {
    let markedDeleted = false
    const row = {
      id:crypto.randomUUID(),media_type:'photo',mime_type:'image/jpeg',status:'deleting',
      staging_original_object_key:'staging/test/original.jpg',staging_display_object_key:null,staging_thumbnail_object_key:null,
      original_object_key:'originals/test.jpg',display_object_key:null,thumbnail_object_key:null,
      size_bytes:12,display_size_bytes:0,thumbnail_size_bytes:0,last_put_expires_at:new Date(0).toISOString(),staging_purged_at:null,
    }
    const env = fakeEnv({
      all: (sql) => sql.includes("status='deleting'") ? [row] : [],
      run: (sql) => { if (sql.includes("status='deleted'")) markedDeleted = true; return { changes:1 } },
    })
    env.MEDIA = { delete:async () => { throw new Error('R2 unavailable') } } as unknown as R2Bucket
    const error = vi.spyOn(console,'error').mockImplementation(() => undefined)
    await cleanupStaleUploads(env)
    expect(markedDeleted).toBe(false)
    expect(error).toHaveBeenCalledWith('Media deletion retry failed',expect.objectContaining({ mediaId:row.id }))
    error.mockRestore()
  })
})
