import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, CheckCircle2, Download, FileJson, LoaderCircle, PackagePlus, RefreshCw, ShieldCheck, X } from 'lucide-react'
import type { ArchiveArtifact, ArchiveJob, EventSlug } from '../../../shared/contracts'
import { cancelAdminArchive, createAdminArchive, getAdminArchiveDownload, getAdminArchives } from '../../services/api'
import { formatBytes } from '../../utils/files'

function download(url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener'
  anchor.download = ''
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

export function AdminArchivePanel() {
  const [jobs, setJobs] = useState<ArchiveJob[]>([])
  const [scope, setScope] = useState<'all'|'event'>('all')
  const [eventSlug, setEventSlug] = useState<EventSlug>('solemnisation')
  const [shardGiB, setShardGiB] = useState('5')
  const [busy, setBusy] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [cancelText, setCancelText] = useState('')
  const lock = useRef(false)

  const load = useCallback(async () => {
    try { setJobs((await getAdminArchives()).jobs); setError(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Archive jobs could not be loaded.') }
    finally { setLoaded(true) }
  }, [])
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 12_000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [load])

  const mutate = async (label: string, action: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true; setBusy(label); setError(null)
    try { await action(); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The archive operation did not finish.') }
    finally { lock.current = false; setBusy(null) }
  }
  const create = () => void mutate('Creating a deterministic inventory snapshot…', () => createAdminArchive({ scope,eventSlug:scope === 'event' ? eventSlug : undefined,shardSizeBytes:Number(shardGiB) * 1024 ** 3 }))
  const getDownload = (jobId: string, target: { partId?:string;artifactKind?:ArchiveArtifact['kind'] }) => void mutate('Preparing a short-lived download…', async () => download((await getAdminArchiveDownload(jobId,target)).url))

  return <div className="admin-archive-panel">
    <div className="admin-section-heading"><div><p className="eyebrow">Final archive</p><h1>Preserve the journey.</h1></div><p>Inventories are immutable snapshots. ZIP64 shards stream outside the Worker and remain independently recoverable.</p></div>
    {error ? <div className="moderation-notice moderation-notice--error" role="alert"><X /><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {busy ? <div className="moderation-notice" role="status"><LoaderCircle className="spin" /><span>{busy}</span></div> : null}
    <section className="admin-operation-card archive-create-card"><div><PackagePlus /><div><p className="settings-card-label">New snapshot</p><h2>Create final archive inventory</h2><p>Available only in post-wedding or archive mode. Pending and rejected media are intentionally retained in the private archive snapshot; deleted media is always excluded.</p></div></div><div className="archive-create-fields"><label><span>Scope</span><select value={scope} onChange={(event) => setScope(event.target.value as 'all'|'event')}><option value="all">Both celebrations</option><option value="event">One celebration</option></select></label>{scope === 'event' ? <label><span>Celebration</span><select value={eventSlug} onChange={(event) => setEventSlug(event.target.value as EventSlug)}><option value="solemnisation">Solemnisation</option><option value="reception">Groom's Reception</option></select></label> : null}<label><span>Target shard size</span><select value={shardGiB} onChange={(event) => setShardGiB(event.target.value)}><option value="2">2 GiB</option><option value="5">5 GiB</option><option value="10">10 GiB</option></select></label></div><button className="button button-primary" type="button" onClick={create} disabled={Boolean(busy)}><Archive />Create inventory</button></section>
    <section className="admin-operation-card builder-instructions"><div><p className="settings-card-label">Builder handoff</p><h2>Run or resume the streaming builder</h2><p>The CLI downloads one original at a time from private R2, computes SHA-256 while writing a deterministic ZIP64 shard, and uploads it with multipart streaming. Its local state is resumable.</p><code>npm run archive:build -- --job &lt;JOB_ID&gt; --resume</code><small>Set ARCHIVE_API_URL, ARCHIVE_BUILDER_TOKEN, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.</small></div><ShieldCheck /></section>
    <div className="admin-card-heading archive-list-heading"><div><p className="settings-card-label">Archive jobs</p><h2>{!loaded ? 'Loading archive jobs…' : jobs.length ? `${jobs.length} snapshots` : 'No archive generated'}</h2></div><button className="refresh-button" type="button" onClick={() => void load()} aria-label="Refresh archives"><RefreshCw /></button></div>
    <div className="archive-job-list">{jobs.map((job) => {
      const percentage = job.totalBytes ? Math.min(100,Math.round(job.processedBytes / job.totalBytes * 100)) : 0
      return <article key={job.id} className="archive-job"><header><div><span>{job.scope === 'all' ? 'Both celebrations' : `Event ${job.eventId || ''}`}</span><strong>{job.id}</strong></div><b className={`job-status job-status--${job.status}`}>{job.status}</b></header><dl><div><dt>Files</dt><dd>{job.processedFiles.toLocaleString()} / {job.totalFiles.toLocaleString()}</dd></div><div><dt>Original bytes</dt><dd>{formatBytes(job.totalBytes)}</dd></div><div><dt>Shard target</dt><dd>{formatBytes(job.shardSizeBytes)}</dd></div><div><dt>Created</dt><dd>{new Date(job.createdAt).toLocaleString()}</dd></div></dl><div className="archive-progress" role="progressbar" aria-label={`Archive ${job.id} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${percentage}% checksummed and registered`}><span style={{ width:`${percentage}%` }} /></div><p aria-live="polite" aria-atomic="true">{percentage}% checksummed and registered</p>{job.errorMessage ? <div className="archive-error" role="alert">{job.errorMessage}</div> : null}{job.parts.length ? <div className="archive-downloads"><h3>ZIP64 parts</h3>{job.parts.map((part) => <div key={part.id}><span><strong>{part.eventDisplayName} · Part {part.partNumber}</strong><small>{part.filename} · {formatBytes(part.sizeBytes)} · SHA-256 {part.sha256}</small></span><button type="button" disabled={job.status !== 'complete'} onClick={() => getDownload(job.id,{ partId:part.id })} aria-label={`Download ${part.filename}`}><Download /></button></div>)}</div> : null}{job.artifacts.length ? <div className="archive-downloads"><h3>Integrity files</h3>{job.artifacts.map((artifact) => <div key={artifact.id}><span><strong>{artifact.kind.replaceAll('_',' ')}</strong><small>{artifact.filename} · SHA-256 {artifact.sha256}</small></span><button type="button" disabled={job.status !== 'complete'} onClick={() => getDownload(job.id,{ artifactKind:artifact.kind })} aria-label={`Download ${artifact.filename}`}><FileJson /></button></div>)}</div> : null}{job.status === 'complete' ? <div className="archive-complete"><CheckCircle2 />Complete and ready for integrity verification</div> : !['cancelled','failed'].includes(job.status) ? <button className="text-danger-action" type="button" onClick={() => { setCancelTarget(job.id);setCancelText('') }}>Cancel snapshot</button> : null}{cancelTarget === job.id ? <div className="archive-cancel"><label><span>Type CANCEL {job.id}</span><input value={cancelText} onChange={(event) => setCancelText(event.target.value)} /></label><button type="button" disabled={cancelText !== `CANCEL ${job.id}`} onClick={() => void mutate('Cancelling archive…',async () => { await cancelAdminArchive(job.id,cancelText);setCancelTarget(null) })}>Confirm cancellation</button></div> : null}</article>
    })}</div>
  </div>
}
