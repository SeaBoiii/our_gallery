import type { Env } from '../env'
import { finalKeys, finalizeUpload, stagingKeys, type FinalizableUploadRow } from '../uploads/finalize'

type CleanupRow = FinalizableUploadRow & {
  last_put_expires_at: string
  staging_purged_at: string | null
}

async function removeAllKnownObjects(env: Env, row: CleanupRow) {
  await env.MEDIA.delete([...finalKeys(row), ...stagingKeys(row)])
}

export async function cleanupStaleUploads(env: Env) {
  const now = new Date().toISOString()
  const stagingCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  // These bounded batches keep the worst-case D1 work below the Workers Free
  // limit of 50 queries per invocation, including reconciliation race reads.
  const stale = await env.DB.prepare("SELECT * FROM media WHERE status IN ('uploading','reconciling') AND upload_expires_at < ? ORDER BY upload_expires_at,id LIMIT 6").bind(now).all<CleanupRow>()
  for (const row of stale.results) {
    try {
      const claim = await env.DB.prepare("UPDATE media SET status='reconciling' WHERE id=? AND status IN ('uploading','reconciling')").bind(row.id).run()
      if (!claim.meta.changes) continue
      const result = await finalizeUpload(env, { ...row, status: 'reconciling' })
      if (result.completed) continue
      await removeAllKnownObjects(env, row)
      await env.DB.prepare("UPDATE media SET status='expired',deleted_at=? WHERE id=? AND status='reconciling'").bind(now,row.id).run()
    } catch (error) {
      // Keep the row reconciling so the next scheduled pass retries it.
      console.error('Upload reconciliation failed', { mediaId: row.id, error })
    }
  }

  const deleting = await env.DB.prepare("SELECT * FROM media WHERE status='deleting' ORDER BY deleted_at,id LIMIT 8").all<CleanupRow>()
  for (const row of deleting.results) {
    try {
      await removeAllKnownObjects(env, row)
      await env.DB.prepare("UPDATE media SET status='deleted',deleted_at=? WHERE id=? AND status='deleting'").bind(now,row.id).run()
    } catch (error) {
      // Deletion is not declared complete until every known key is removed.
      console.error('Media deletion retry failed', { mediaId: row.id, error })
    }
  }

  // Signed writes only target staging/. Once the latest PUT has expired plus a
  // five-minute in-flight grace period, this ordered tombstone pass guarantees
  // that a late staging object is removed. The bucket lifecycle rule is backup.
  const purgeable = await env.DB.prepare(`SELECT * FROM media
    WHERE staging_purged_at IS NULL
      AND last_put_expires_at < ?
      AND status NOT IN ('uploading','reconciling','deleting')
    ORDER BY last_put_expires_at,id LIMIT 8`).bind(stagingCutoff).all<CleanupRow>()
  for (const row of purgeable.results) {
    try {
      await env.MEDIA.delete(stagingKeys(row))
      await env.DB.prepare('UPDATE media SET staging_purged_at=? WHERE id=? AND staging_purged_at IS NULL').bind(now,row.id).run()
    } catch (error) {
      console.error('Staging purge failed', { mediaId: row.id, error })
    }
  }

  const epoch = Math.floor(Date.now()/1000)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(epoch),
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').bind(epoch,epoch-86_400),
    env.DB.prepare('DELETE FROM upload_requests WHERE expires_at < ?').bind(now),
  ])
}
