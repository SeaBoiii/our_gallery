import { describe, expect, it } from 'vitest'
import { adminBatchMediaRoute, adminStatsRoute } from './admin'
import { createAdminSession } from '../security/adminSession'
import { fakeEnv } from '../../test/fake'

describe('admin protection', () => {
  it('rejects unauthenticated admin requests', async () => {
    const request = new Request('https://api.test/api/admin/stats',{ headers:{ Origin:'http://localhost:5173' } })
    await expect(adminStatsRoute(request,fakeEnv())).rejects.toMatchObject({ code:'ADMIN_REQUIRED' })
  })

  it('applies a moderation transition to selected memories', async () => {
    let activeSession: { hash: string; expires: number } | null = null
    const env = fakeEnv({
      first: (sql) => sql.includes('FROM admin_sessions') && activeSession ? { expires_at: activeSession.expires, revoked_at: null } : null,
      run: (sql, bindings) => {
        if (sql.includes('INSERT INTO admin_sessions')) activeSession = { hash: String(bindings[0]), expires: Number(bindings[2]) }
        if (sql.includes('UPDATE media SET status=')) return { changes: 2 }
        return { changes: 1 }
      },
    })
    const session = await createAdminSession(env)
    const ids = [crypto.randomUUID(),crypto.randomUUID()]
    const request = new Request('https://api.test/api/admin/media/batch',{ method:'PATCH',headers:{ Origin:'http://localhost:5173','Content-Type':'application/json',Cookie:session.cookie.split(';')[0] },body:JSON.stringify({ ids,status:'approved' }) })
    const response = await adminBatchMediaRoute(request,env)
    const body = await response.json() as { ok:boolean;data:{updated:number} }
    expect(body.ok).toBe(true)
    expect(body.data.updated).toBe(2)
  })

  it('chunks maximum moderation batches within D1\'s 100 bound-parameter limit', async () => {
    let activeSession: { expires: number } | null = null
    let maxBindings = 0
    const env = fakeEnv({
      first: (sql) => sql.includes('FROM admin_sessions') && activeSession ? { expires_at: activeSession.expires, revoked_at: null } : null,
      run: (sql,bindings) => {
        if (sql.includes('INSERT INTO admin_sessions')) activeSession = { expires:Number(bindings[2]) }
        return { changes:1 }
      },
      batch: (statements) => { maxBindings = Math.max(...statements.map((statement) => statement.bindings.length)) },
    })
    const session = await createAdminSession(env)
    const request = new Request('https://api.test/api/admin/media/batch',{ method:'PATCH',headers:{ Origin:'http://localhost:5173','Content-Type':'application/json',Cookie:session.cookie.split(';')[0] },body:JSON.stringify({ ids:Array.from({ length:99 },() => crypto.randomUUID()),status:'approved' }) })
    const response = await adminBatchMediaRoute(request,env)
    expect(response.status).toBe(200)
    expect(maxBindings).toBeLessThanOrEqual(100)
  })
})
