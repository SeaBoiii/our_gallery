#!/usr/bin/env node

function usage() {
  return `Usage: npm run ai:purge-faces -- --confirm "PURGE FACE INDEX"

Required environment:
  MAINTENANCE_API_URL
  MAINTENANCE_TOKEN

This irreversible command disables Find Me, queues deletion of every face vector,
and clears D1 face embedding references. Ordinary media, categories, captions,
and semantic vectors are retained.`
}

const args=process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) { process.stdout.write(`${usage()}\n`);process.exit(0) }
const confirmationIndex=args.indexOf('--confirm')
const confirmation=confirmationIndex>=0?args[confirmationIndex+1]:''
if (confirmation!=='PURGE FACE INDEX') throw new Error('Refusing to continue. Pass --confirm "PURGE FACE INDEX" exactly.')
const apiUrl=(process.env.MAINTENANCE_API_URL || '').replace(/\/+$/,'')
const token=process.env.MAINTENANCE_TOKEN || ''
if (!/^https:\/\//.test(apiUrl)) throw new Error('MAINTENANCE_API_URL must be an absolute HTTPS URL.')
if (token.length<32) throw new Error('MAINTENANCE_TOKEN is required and must contain at least 32 characters.')
const response=await fetch(`${apiUrl}/api/maintenance/ai/purge-faces`,{ method:'POST',headers:{ Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${token}` },body:JSON.stringify({ confirmation }) })
const envelope=await response.json().catch(()=>null)
if (!response.ok || !envelope?.ok) throw new Error(envelope?.error?.message || `Maintenance API returned HTTP ${response.status}`)
process.stdout.write(`Find Me disabled. Face purge job queued: ${envelope.data.jobId}\n`)
