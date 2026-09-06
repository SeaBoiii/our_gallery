#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { once } from 'node:events'
import { ZipArchive } from 'archiver'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import {
  assignArchiveNames,
  checksumsFile,
  manifestCsv,
  manifestEntry,
  parseByteSize,
  partFilename,
  partPlanSha256,
  planShards,
  sha256Hex,
} from './lib.mjs'

const FIXED_ZIP_DATE = new Date('1980-01-01T00:00:00.000Z')
const ARCHIVE_API_BATCH = 15
const MAX_FILES_PER_PART = 10_000
const REQUEST_TIMEOUT_MS = 30_000

function usage() {
  return `Usage: npm run archive:build -- --job <uuid> [--all | --event <slug>] [--shard-size 5GB] [--resume] [--dry-run]

Required environment:
  ARCHIVE_API_URL, ARCHIVE_BUILDER_TOKEN
  R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

Options:
  --api-url <url>       Override ARCHIVE_API_URL
  --state-dir <path>    Resume-state directory (default .archive-state)
  --event <slug>        Build one event; leaves an all-event job partial
  --all                 Build the full job inventory (default)
  --shard-size <size>   2GB to 10GB; locks after the first completed part
  --resume              Reuse completed/uploaded deterministic shards
  --dry-run             Print the shard plan without claiming or writing
  --help                 Show this help`
}

function parseArgs(argv) {
  const options = { all:false,resume:false,dryRun:false,stateDir:'.archive-state' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--all') options.all = true
    else if (arg === '--resume') options.resume = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (['--job','--event','--shard-size','--api-url','--state-dir'].includes(arg)) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      const key = { '--job':'jobId','--event':'event','--shard-size':'shardSize','--api-url':'apiUrl','--state-dir':'stateDir' }[arg]
      options[key] = value
      index += 1
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (options.help) return options
  if (!/^[0-9a-f-]{36}$/i.test(options.jobId || '')) throw new Error('--job must be a valid archive job UUID')
  if (options.event && options.all) throw new Error('Choose either --event or --all, not both')
  if (options.event && !['solemnisation','reception'].includes(options.event)) throw new Error('--event must be solemnisation or reception')
  if (options.shardSize) options.shardSizeBytes = parseByteSize(options.shardSize)
  return options
}

function requiredEnv(name, minimum = 1) {
  const value = process.env[name]
  if (!value || value.length < minimum) throw new Error(`${name} is required`)
  return value
}

function configuration(options, requireR2 = true) {
  const apiUrl = (options.apiUrl || requiredEnv('ARCHIVE_API_URL')).replace(/\/+$/, '')
  const token = requiredEnv('ARCHIVE_BUILDER_TOKEN', 32)
  const config = { apiUrl, token }
  if (requireR2) Object.assign(config, {
    accountId:requiredEnv('R2_ACCOUNT_ID'),bucket:requiredEnv('R2_BUCKET_NAME'),
    accessKeyId:requiredEnv('R2_ACCESS_KEY_ID'),secretAccessKey:requiredEnv('R2_SECRET_ACCESS_KEY'),
  })
  return config
}

async function api(config, path, init = {}, { ignoreRunSignal = false } = {}) {
  const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)]
  if (config.signal && !ignoreRunSignal) signals.push(config.signal)
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    signal:AbortSignal.any(signals),
    headers: { Accept:'application/json',Authorization:`Bearer ${config.token}`,...init.headers },
  })
  const envelope = await response.json().catch(() => null)
  if (!response.ok || !envelope?.ok) {
    const error = new Error(envelope?.error?.message || `Archive API returned HTTP ${response.status}`)
    error.code = envelope?.error?.code || `HTTP_${response.status}`
    throw error
  }
  return envelope.data
}

const jsonInit = (method, body) => ({ method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body) })

async function allInventory(config, jobId, event) {
  const items = []
  let cursor = null
  do {
    const query = new URLSearchParams({ limit:'500' })
    if (event) query.set('event', event)
    if (cursor) query.set('cursor', cursor)
    const page = await api(config, `/api/archive-builder/jobs/${jobId}/items?${query}`)
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

async function loadState(path, resume, jobId) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (!resume) throw new Error(`Resume state already exists at ${path}; use --resume or choose a new state directory`)
    if (parsed.schemaVersion !== 1 || parsed.jobId !== jobId || typeof parsed.builderId !== 'string') throw new Error('Resume state does not match this archive job')
    return parsed
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { schemaVersion:1,jobId,builderId:`${hostname()}:${process.pid}:${randomUUID()}`,parts:{} }
  }
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive:true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(state,null,2)}\n`, { mode:0o600 })
  await rename(temporary, path)
}

function nodeReadable(body) {
  if (!body) throw new Error('R2 returned an empty object body')
  if (typeof body.pipe === 'function') return body
  if (typeof body.transformToWebStream === 'function') return Readable.fromWeb(body.transformToWebStream())
  if (body instanceof ReadableStream) return Readable.fromWeb(body)
  throw new Error('R2 returned an unsupported streaming body')
}

function hashingTransform(hash, counter) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      counter.bytes += chunk.length
      callback(null, chunk)
    },
  })
}

async function streamPart({ s3,bucket,jobId,plan,objectKey,signal }) {
  const zip = new ZipArchive({ forceZip64:true,store:true,zlib:{ level:0 } })
  const zipHash = createHash('sha256')
  const zipCounter = { bytes:0 }
  const output = hashingTransform(zipHash,zipCounter)
  zip.on('warning', (warning) => output.destroy(warning))
  zip.on('error', (error) => output.destroy(error))
  zip.pipe(output)
  const upload = new Upload({
    client:s3,
    params:{ Bucket:bucket,Key:objectKey,Body:output,ContentType:'application/zip' },
    queueSize:4,
    partSize:10 * 1024 ** 2,
    leavePartsOnError:false,
  })
  const uploadPromise = upload.done()
  void uploadPromise.catch((error) => output.destroy(error))
  const abortUpload = () => {
    const reason = signal?.reason instanceof Error ? signal.reason : new Error('Archive build interrupted')
    zip.abort()
    output.destroy(reason)
    void upload.abort().catch(() => undefined)
  }
  signal?.addEventListener('abort',abortUpload,{ once:true })
  const completedItems = []
  try {
    signal?.throwIfAborted()
    for (const item of plan.items) {
      signal?.throwIfAborted()
      const response = await s3.send(new GetObjectCommand({ Bucket:bucket,Key:item.originalObjectKey }),{ abortSignal:signal })
      if (Number(response.ContentLength) !== Number(item.sizeBytes)) throw new Error(`Original size changed for ${item.mediaId}`)
      const sourceHash = createHash('sha256')
      const sourceCounter = { bytes:0 }
      const meter = hashingTransform(sourceHash,sourceCounter)
      const source = nodeReadable(response.Body)
      source.on('error', (error) => meter.destroy(error))
      source.pipe(meter)
      const ended = once(meter,'end')
      zip.append(meter,{ name:item.archiveFilename,date:FIXED_ZIP_DATE,mode:0o644,store:true })
      await ended
      if (sourceCounter.bytes !== Number(item.sizeBytes)) throw new Error(`Original stream length changed for ${item.mediaId}`)
      const sha256 = sourceHash.digest('hex')
      if (item.sha256 && item.sha256.toLowerCase() !== sha256) throw new Error(`Verified original checksum changed for ${item.mediaId}`)
      const completed = { ...item,sha256 }
      completedItems.push(completed)
      const metadata = `${JSON.stringify(manifestEntry(completed),null,2)}\n`
      zip.append(Buffer.from(metadata),{ name:item.metadataFilename,date:FIXED_ZIP_DATE,mode:0o644,store:true })
    }
    const partManifest = `${JSON.stringify({ schema_version:1,archive_job_id:jobId,event:plan.eventDisplayName,part_number:plan.partNumber,media:completedItems.map(manifestEntry) },null,2)}\n`
    zip.append(Buffer.from(partManifest),{ name:'manifest.json',date:FIXED_ZIP_DATE,mode:0o644,store:true })
    zip.append(Buffer.from(manifestCsv(completedItems)),{ name:'manifest.csv',date:FIXED_ZIP_DATE,mode:0o644,store:true })
    zip.append(Buffer.from(checksumsFile(completedItems)),{ name:'checksums.sha256',date:FIXED_ZIP_DATE,mode:0o644,store:true })
    await zip.finalize()
    await uploadPromise
    return { items:completedItems,sha256:zipHash.digest('hex'),sizeBytes:zipCounter.bytes }
  } catch (error) {
    zip.abort()
    await upload.abort().catch(() => undefined)
    await uploadPromise.catch(() => undefined)
    throw error
  } finally { signal?.removeEventListener('abort',abortUpload) }
}

async function postChecksums(config, jobId, builderId, leaseGeneration, plan, items) {
  for (let offset = 0; offset < items.length; offset += ARCHIVE_API_BATCH) {
    const batch = items.slice(offset,offset + ARCHIVE_API_BATCH).map((item) => ({ mediaId:item.mediaId,sha256:item.sha256,archiveFilename:item.archiveFilename,partNumber:plan.partNumber }))
    await api(config,`/api/archive-builder/jobs/${jobId}/checksums`,jsonInit('POST',{ builderId,leaseGeneration,items:batch }))
  }
}

async function putArtifact(s3,bucket,key,filename,kind,content,signal) {
  const sha256 = sha256Hex(content)
  const sizeBytes = Buffer.byteLength(content)
  const contentType = filename.endsWith('.json') ? 'application/json' : filename.endsWith('.csv') ? 'text/csv' : 'text/plain'
  await s3.send(new PutObjectCommand({ Bucket:bucket,Key:key,Body:content,ContentType:contentType }),{ abortSignal:signal })
  return { kind,objectKey:key,filename,sizeBytes,sha256 }
}

function completedItemCount(items) { return items.filter((item) => /^[a-f0-9]{64}$/i.test(item.sha256 || '')).length }
function completedItemBytes(items) { return items.filter((item) => /^[a-f0-9]{64}$/i.test(item.sha256 || '')).reduce((sum,item) => sum + Number(item.sizeBytes),0) }
function leaseGenerationFromObjectKey(objectKey) {
  const match = String(objectKey || '').match(/\/lease-(\d+)\//)
  const generation = Number(match?.[1])
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('Resume state contains an invalid archive part object key')
  return generation
}

function installSignalHandlers(controller) {
  let signalCount = 0
  const handler = (signal) => {
    signalCount += 1
    const exitCode = signal === 'SIGINT' ? 130 : 143
    if (signalCount > 1) process.exit(exitCode)
    const error = Object.assign(new Error(`Archive builder interrupted by ${signal}`), { code:'BUILDER_INTERRUPTED',exitCode,signal })
    controller.abort(error)
  }
  const onInterrupt = () => handler('SIGINT')
  const onTerminate = () => handler('SIGTERM')
  process.on('SIGINT',onInterrupt)
  process.on('SIGTERM',onTerminate)
  return () => {
    process.off('SIGINT',onInterrupt)
    process.off('SIGTERM',onTerminate)
  }
}

async function main() {
  const runController = new AbortController()
  const removeSignalHandlers = installSignalHandlers(runController)
  try {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { process.stdout.write(`${usage()}\n`); return }
  const config = configuration(options,!options.dryRun)
  config.signal = runController.signal
  const job = await api(config,`/api/archive-builder/jobs/${options.jobId}`)
  const allItemsRaw = await allInventory(config,options.jobId,null)
  const selectedRaw = options.event ? allItemsRaw.filter((item) => item.eventSlug === options.event) : allItemsRaw
  const targetBytes = options.shardSizeBytes || Number(job.shardSizeBytes)
  if (targetBytes < 2 * 1024 ** 3 || targetBytes > 10 * 1024 ** 3) throw new Error('Shard size must be between 2GB and 10GB')
  const allNamed = assignArchiveNames(allItemsRaw)
  const selectedIds = new Set(selectedRaw.map((item) => item.mediaId))
  const selectedRawById = new Map(selectedRaw.map((item)=>[item.mediaId,item]))
  const selectedNamed = allNamed.filter((item) => selectedIds.has(item.mediaId))
  for (const item of selectedNamed) {
    const prior = selectedRawById.get(item.mediaId)
    if (prior?.archiveFilename && prior.archiveFilename !== item.archiveFilename) throw new Error(`Deterministic archive name changed for ${item.mediaId}`)
  }
  const plans = planShards(selectedNamed,targetBytes,4_096,MAX_FILES_PER_PART,true)
  const summary = plans.map((plan) => ({ event:plan.eventSlug,part:plan.partNumber,files:plan.items.length,estimatedBytes:plan.estimatedBytes,planSha256:partPlanSha256(plan) }))
  process.stdout.write(`${JSON.stringify({ jobId:options.jobId,files:selectedNamed.length,totalBytes:selectedNamed.reduce((sum,item) => sum + Number(item.sizeBytes),0),targetBytes,parts:summary },null,2)}\n`)
  if (options.dryRun) return

  const statePath = resolve(options.stateDir,`${options.jobId}.json`)
  const state = await loadState(statePath,options.resume,options.jobId)
  const claim = await api(config,`/api/archive-builder/jobs/${options.jobId}/claim`,jsonInit('POST',{ builderId:state.builderId,shardSizeBytes:targetBytes }))
  state.leaseGeneration = claim.leaseGeneration
  state.leaseExpiresAt = claim.leaseExpiresAt
  await saveState(statePath,state)
  let heartbeatProgress = { files:completedItemCount(allItemsRaw),bytes:completedItemBytes(allItemsRaw) }
  const completedMediaIds = new Set(allItemsRaw.filter((item)=>/^[a-f0-9]{64}$/i.test(item.sha256 || '')).map((item)=>item.mediaId))
  const markCompleted = (items) => {
    for (const item of items) {
      if (completedMediaIds.has(item.mediaId)) continue
      completedMediaIds.add(item.mediaId)
      heartbeatProgress.files += 1
      heartbeatProgress.bytes += Number(item.sizeBytes)
    }
  }
  let nextPlanLeaseRenewal = Date.now() + 60_000
  for (const plan of plans) {
    const planSha256 = partPlanSha256(plan)
    for (let offset = 0; offset < plan.items.length; offset += ARCHIVE_API_BATCH) {
      const items = plan.items.slice(offset,offset + ARCHIVE_API_BATCH).map((item) => ({ mediaId:item.mediaId,archiveFilename:item.archiveFilename }))
      await api(config,`/api/archive-builder/jobs/${options.jobId}/plan`,jsonInit('POST',{
        builderId:state.builderId,leaseGeneration:state.leaseGeneration,eventId:plan.eventId,partNumber:plan.partNumber,
        planSha256,fileCount:plan.items.length,items,finalize:offset + items.length === plan.items.length,
      }))
      if (Date.now() >= nextPlanLeaseRenewal) {
        const renewed = await api(config,`/api/archive-builder/jobs/${options.jobId}/progress`,jsonInit('PATCH',{
          builderId:state.builderId,leaseGeneration:state.leaseGeneration,status:'building',processedFiles:heartbeatProgress.files,processedBytes:heartbeatProgress.bytes,
        }))
        state.leaseExpiresAt = renewed.leaseExpiresAt
        nextPlanLeaseRenewal = Date.now() + 60_000
      }
    }
  }
  const s3 = new S3Client({
    region:'auto',endpoint:`https://${config.accountId}.r2.cloudflarestorage.com`,forcePathStyle:true,
    credentials:{ accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey },
  })
  let claimed = true
  let heartbeatError = null
  let heartbeatPromise = Promise.resolve()
  const heartbeatTimer = setInterval(() => {
    heartbeatPromise = heartbeatPromise.then(async () => {
      const heartbeat = await api(config,`/api/archive-builder/jobs/${options.jobId}/progress`,jsonInit('PATCH',{
        builderId:state.builderId,leaseGeneration:state.leaseGeneration,status:'building',processedFiles:heartbeatProgress.files,processedBytes:heartbeatProgress.bytes,
      }))
      heartbeatError = null
      state.leaseExpiresAt = heartbeat.leaseExpiresAt
    }).catch((error) => {
      heartbeatError = error
      const nearDeadline = !Number.isFinite(Date.parse(state.leaseExpiresAt || '')) || Date.parse(state.leaseExpiresAt) - Date.now() <= 30_000
      if (error.code === 'ARCHIVE_LEASE_EXPIRED' || nearDeadline) runController.abort(error)
    })
  },60_000)
  const stopHeartbeat = async () => { clearInterval(heartbeatTimer); await heartbeatPromise }
  try {
    const claimedJob = await api(config,`/api/archive-builder/jobs/${options.jobId}`)
    const completedByApi = new Map(claimedJob.parts.filter((part) => part.status === 'complete').map((part) => [`${part.eventId}:${part.partNumber}`,part]))
    for (const plan of plans) {
      const planSha256 = partPlanSha256(plan)
      const key = `${plan.eventId}:${plan.partNumber}`
      const filename = partFilename(plan)
      const objectKey = `archives/${options.jobId}/parts/${plan.eventSlug}/${planSha256}/lease-${state.leaseGeneration}/${filename}`
      const apiPart = completedByApi.get(key)
      if (apiPart) {
        if (!options.resume) throw new Error(`Part ${filename} already exists; rerun with --resume`)
        if (apiPart.planSha256 !== planSha256 || apiPart.fileCount !== plan.items.length) throw new Error(`Completed part ${filename} does not match the current deterministic plan`)
        if (plan.items.some((item) => !/^[a-f0-9]{64}$/i.test(item.sha256 || '') || Number(item.assignedPart) !== plan.partNumber)) throw new Error(`Completed part ${filename} is missing item checksums`)
        state.parts[key] = { status:'complete',planSha256,filename,sha256:apiPart.sha256,sizeBytes:apiPart.sizeBytes }
        await saveState(statePath,state)
        continue
      }

      let uploaded = state.parts[key]
      if (options.resume && uploaded?.status === 'uploaded' && uploaded.planSha256 === planSha256 && uploaded.objectKey && Array.isArray(uploaded.items)) {
        await postChecksums(config,options.jobId,state.builderId,state.leaseGeneration,plan,uploaded.items)
      } else {
        process.stdout.write(`Building ${filename} (${plan.items.length} files)\n`)
        const built = await streamPart({ s3,bucket:config.bucket,jobId:options.jobId,plan,objectKey,signal:runController.signal })
        if (heartbeatError) throw heartbeatError
        uploaded = { status:'uploaded',planSha256,filename,objectKey,sha256:built.sha256,sizeBytes:built.sizeBytes,items:built.items.map((item) => ({ mediaId:item.mediaId,sha256:item.sha256,archiveFilename:item.archiveFilename })) }
        state.parts[key] = uploaded
        await saveState(statePath,state)
        await postChecksums(config,options.jobId,state.builderId,state.leaseGeneration,plan,built.items)
      }
      const uploadedObjectKey = uploaded.objectKey
      await api(config,`/api/archive-builder/jobs/${options.jobId}/parts`,jsonInit('POST',{
        builderId:state.builderId,leaseGeneration:state.leaseGeneration,objectLeaseGeneration:leaseGenerationFromObjectKey(uploadedObjectKey),
        eventId:plan.eventId,partNumber:plan.partNumber,objectKey:uploadedObjectKey,filename,
        sizeBytes:uploaded.sizeBytes,sha256:uploaded.sha256,planSha256,fileCount:plan.items.length,
      }))
      state.parts[key] = { status:'complete',planSha256,filename,objectKey:uploadedObjectKey,sha256:uploaded.sha256,sizeBytes:uploaded.sizeBytes }
      await saveState(statePath,state)
      markCompleted(plan.items)
      const renewed = await api(config,`/api/archive-builder/jobs/${options.jobId}/progress`,jsonInit('PATCH',{
        builderId:state.builderId,leaseGeneration:state.leaseGeneration,status:'building',processedFiles:heartbeatProgress.files,processedBytes:heartbeatProgress.bytes,
      }))
      state.leaseExpiresAt = renewed.leaseExpiresAt
    }

    const coversWholeJob = selectedNamed.length === allNamed.length
    if (!coversWholeJob) {
      await stopHeartbeat()
      const renewed = await api(config,`/api/archive-builder/jobs/${options.jobId}/progress`,jsonInit('PATCH',{
        builderId:state.builderId,leaseGeneration:state.leaseGeneration,status:'partial',processedFiles:heartbeatProgress.files,processedBytes:heartbeatProgress.bytes,
      }))
      state.leaseExpiresAt = renewed.leaseExpiresAt
      process.stdout.write('Selected event is complete; the all-event archive job remains partial. Resume with --all to finish it.\n')
      return
    }

    const finalRaw = await allInventory(config,options.jobId,null)
    const finalById = new Map(finalRaw.map((item) => [item.mediaId,item]))
    const finalItems = allNamed.map((item) => ({ ...item,...finalById.get(item.mediaId),archiveFilename:item.archiveFilename }))
    if (finalItems.some((item) => !/^[a-f0-9]{64}$/i.test(item.sha256 || ''))) throw new Error('Not every active inventory item has an exact checksum')
    const latestJob = await api(config,`/api/archive-builder/jobs/${options.jobId}`)
    const artifactInputs = [
      ['manifest_json','manifest.json',()=>`${JSON.stringify({ schema_version:1,archive_job_id:options.jobId,created_at:job.createdAt,media:finalItems.map(manifestEntry) },null,2)}\n`],
      ['manifest_csv','manifest.csv',()=>manifestCsv(finalItems)],
      ['checksums','checksums.sha256',()=>checksumsFile(finalItems,latestJob.parts.filter((part) => part.status === 'complete'))],
      ['readme','README.txt',()=>`ALEEM × NURUL WEDDING ARCHIVE\n\nArchive job: ${options.jobId}\nCreated: ${job.createdAt}\n\nThis archive preserves original uploaded bytes and human-readable metadata.\nVerify files with checksums.sha256. ZIP parts use ZIP64 and deterministic entry ordering.\nFace vectors, selfie searches, rate-limit data, and administrative secrets are intentionally excluded.\n`],
    ]
    const artifacts = []
    for (const [kind,filename,createContent] of artifactInputs) {
      const content = createContent()
      const key = `archives/${options.jobId}/metadata/${sha256Hex(content)}/${filename}`
      artifacts.push(await putArtifact(s3,config.bucket,key,filename,kind,content,runController.signal))
    }
    await api(config,`/api/archive-builder/jobs/${options.jobId}/artifacts`,jsonInit('POST',{ builderId:state.builderId,leaseGeneration:state.leaseGeneration,artifacts }))
    await stopHeartbeat()
    await api(config,`/api/archive-builder/jobs/${options.jobId}/complete`,jsonInit('POST',{ builderId:state.builderId,leaseGeneration:state.leaseGeneration }))
    claimed = false
    process.stdout.write(`Archive ${options.jobId} is complete.\n`)
  } catch (error) {
    await stopHeartbeat()
    if (claimed) {
      await saveState(statePath,state).catch(() => undefined)
      const interrupted = error.code === 'BUILDER_INTERRUPTED' || runController.signal.reason?.code === 'BUILDER_INTERRUPTED'
      await api(config,`/api/archive-builder/jobs/${options.jobId}/progress`,jsonInit('PATCH',{
        builderId:state.builderId,leaseGeneration:state.leaseGeneration,status:interrupted ? 'partial' : 'failed',processedFiles:heartbeatProgress.files,processedBytes:heartbeatProgress.bytes,
        errorCode:String(error.code || 'ARCHIVE_BUILD_FAILED').slice(0,80),errorMessage:String(error.message || error).slice(0,240),
      }),{ ignoreRunSignal:true }).catch(() => undefined)
    }
    if (runController.signal.reason?.code === 'BUILDER_INTERRUPTED') throw runController.signal.reason
    throw error
  } finally { clearInterval(heartbeatTimer); s3.destroy() }
  } finally { removeSignalHandlers() }
}

main().catch((error) => {
  process.stderr.write(`Archive builder failed: ${error.message || error}\n`)
  process.exitCode = Number(error.exitCode) || 1
})
