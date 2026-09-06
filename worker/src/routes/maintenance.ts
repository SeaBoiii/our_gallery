import type { Env } from '../env'
import { enqueueAiJob } from '../ai/jobs'
import { HttpError, json, parseJson } from '../lib/http'
import { verifySecret } from '../security/hash'

async function requireMaintenance(request: Request,env: Env) {
  const expected=env.MAINTENANCE_TOKEN
  if (!expected || expected.length<32) throw new HttpError(503,'MAINTENANCE_UNCONFIGURED','The maintenance credential is not configured.')
  const header=request.headers.get('Authorization') || ''
  const candidate=header.startsWith('Bearer ')?header.slice(7):''
  if (!candidate || candidate.length>512 || !await verifySecret(candidate,expected,env.RATE_LIMIT_SECRET)) throw new HttpError(401,'MAINTENANCE_REQUIRED','A valid maintenance credential is required.')
}

export async function maintenancePurgeFacesRoute(request: Request,env: Env) {
  await requireMaintenance(request,env)
  const payload=await parseJson<{ confirmation?:string }>(request)
  if (payload.confirmation!=='PURGE FACE INDEX') throw new HttpError(400,'PURGE_CONFIRMATION_REQUIRED','Type PURGE FACE INDEX to continue.')
  const now=new Date().toISOString()
  await env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES('face_search_enabled','false',?) ON CONFLICT(key) DO UPDATE SET value='false',updated_at=excluded.updated_at").bind(now).run()
  const jobId=await enqueueAiJob(env,'PURGE_ALL_FACES',null,'maintenance-cli',{ uniqueSuffix:crypto.randomUUID(),priority:1 })
  await env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,metadata_json,created_at) VALUES(?,?,?,?,NULL,?)').bind(crypto.randomUUID(),'maintenance-cli','face_index_purge_requested',jobId,now).run()
  return json(request,env,{ jobId,findMeDisabled:true },202,{ 'Cache-Control':'no-store' })
}
