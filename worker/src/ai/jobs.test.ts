import { describe,expect,it,vi } from 'vitest'
import { fakeEnv,FakeStatement } from '../../test/fake'
import { approvalAiOutboxStatements,cleanupAiOutboxStatements,consumeAiQueue,dispatchPendingAiJobs,faceToggleAiOutboxStatements,reprocessAiOutboxStatements } from './jobs'
import { AI_MESSAGE_SCHEMA_VERSION,type AiQueueMessage } from './types'

function expectBindingsMatch(statements: D1PreparedStatement[]) {
  for (const statement of statements as unknown as FakeStatement[]) {
    expect(statement.bindings,statement.sql).toHaveLength((statement.sql.match(/\?/g) || []).length)
  }
}

describe('AI outbox fencing',()=>{
  it('keeps generated moderation and face-toggle statements bind-safe and deterministic',()=>{
    const env=fakeEnv()
    const id=crypto.randomUUID()
    const now=new Date().toISOString()
    const approval=approvalAiOutboxStatements(env,[id],'test',now)
    const cleanup=cleanupAiOutboxStatements(env,[id],'test',now)
    const reprocess=reprocessAiOutboxStatements(env,[id],'test',now,'run-1')
    const enabled=faceToggleAiOutboxStatements(env,id,true,2,'test',now)
    const disabled=faceToggleAiOutboxStatements(env,id,false,2,'test',now)
    ;[approval,cleanup,reprocess,enabled,disabled].forEach(expectBindingsMatch)
    expect((approval[1] as unknown as FakeStatement).sql).toContain('m.moderation_revision')
    expect((enabled[1] as unknown as FakeStatement).sql).toContain('m.face_search_revision')
  })

  it('persists a fresh dispatch token before publishing and marks that token afterward',async()=>{
    const order:string[]=[]
    const sendBatch=vi.fn(async(messages:Array<{ body:AiQueueMessage }>)=>{
      order.push('send')
      expect(messages[0].body.schemaVersion).toBe(AI_MESSAGE_SCHEMA_VERSION)
      expect(messages[0].body.dispatchToken).toHaveLength(36)
    })
    const env=fakeEnv({
      all:(sql)=>sql.includes('SELECT key,value FROM settings')
        ? [{ key:'ai_enabled',value:'true' },{ key:'ai_processing_paused',value:'false' }]
        : sql.includes('FROM ai_jobs WHERE status=')
          ? [{ id:'analyse:one',job_type:'ANALYSE_MEDIA',media_id:crypto.randomUUID(),analysis_version:1,status:'queued',attempt_count:0 }]
          : [],
      run:(sql)=>{
        if (sql.includes('SET dispatch_token=')) order.push('token')
        if (sql.includes("SET status='dispatched'")) order.push('mark')
        return { changes:1 }
      },
    })
    env.AI_PROCESSING_QUEUE={ sendBatch } as unknown as Queue<AiQueueMessage>
    expect(await dispatchPendingAiJobs(env)).toBe(1)
    expect(order).toEqual(['token','send','mark'])
  })

  it('never lets a paused duplicate demote a processing job',async()=>{
    const sql:string[]=[]
    const ack=vi.fn()
    const env=fakeEnv({
      all:(statement)=>statement.includes('SELECT key,value FROM settings')
        ? [{ key:'ai_enabled',value:'true' },{ key:'ai_processing_paused',value:'true' }]
        : [],
      run:(statement)=>{ sql.push(statement);return { changes:0 } },
    })
    const body:AiQueueMessage={ schemaVersion:AI_MESSAGE_SCHEMA_VERSION,jobId:'analyse:one',type:'ANALYSE_MEDIA',mediaId:crypto.randomUUID(),analysisVersion:1,dispatchToken:crypto.randomUUID() }
    await consumeAiQueue(env,{ queue:'gallery-ai-processing',messages:[{ body,ack,retry:vi.fn() }] } as unknown as MessageBatch<AiQueueMessage>)
    expect(ack).toHaveBeenCalledOnce()
    expect(sql.join('\n')).not.toContain("status IN ('dispatched','processing')")
    expect(sql.join('\n')).toContain("status IN ('queued','dispatched')")
  })

  it('recovers a crash between the D1 claim and Workflow creation',async()=>{
    const token=crypto.randomUUID()
    const create=vi.fn(async()=>({}))
    const ack=vi.fn()
    const env=fakeEnv({
      all:(sql)=>sql.includes('SELECT key,value FROM settings')?[{ key:'ai_enabled',value:'true' },{ key:'ai_processing_paused',value:'false' }]:[],
      first:(sql)=>sql.includes('SELECT status,workflow_id,dispatch_token')
        ? { status:'processing',workflow_id:`ai:${token}`,dispatch_token:token,attempt_count:1,max_attempts:6 }
        : null,
      run:(sql)=>({ changes:sql.includes("SET status='processing'")?0:1 }),
    })
    env.MEDIA_ANALYSIS_WORKFLOW={
      get:async()=>({ status:async()=>({ status:'unknown' }) }),
      create,
    } as unknown as Workflow<AiQueueMessage>
    const body:AiQueueMessage={ schemaVersion:AI_MESSAGE_SCHEMA_VERSION,jobId:'analyse:one',type:'ANALYSE_MEDIA',mediaId:crypto.randomUUID(),analysisVersion:1,dispatchToken:token }
    await consumeAiQueue(env,{ queue:'gallery-ai-processing',messages:[{ body,ack,retry:vi.fn() }] } as unknown as MessageBatch<AiQueueMessage>)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id:`ai:${token}`,params:body }))
    expect(ack).toHaveBeenCalledOnce()
  })
})
