import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, BrainCircuit, CheckCircle2, Clock3, LoaderCircle, Pause, Play, RefreshCw, RotateCcw, ScanFace, Search, Tags, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AdminAiStats, AiJob } from '../../../shared/contracts'
import { backfillAdminAi, getAdminAiJobs, getAdminAiStats, getAdminSettings, purgeFaceIndex, updateAdminAiJob, updateAdminSettings } from '../../services/api'

export function AdminAiPanel() {
  const [stats, setStats] = useState<AdminAiStats | null>(null)
  const [jobs, setJobs] = useState<AiJob[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [purgeConfirmation, setPurgeConfirmation] = useState('')
  const mutationLock = useRef(false)

  const load = useCallback(async () => {
    try {
      const [nextStats, nextJobs] = await Promise.all([getAdminAiStats(), getAdminAiJobs()])
      setStats(nextStats)
      setJobs(nextJobs.jobs)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI operations could not be loaded.') }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 10_000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [load])

  const mutate = async (label: string, action: () => Promise<unknown>) => {
    if (mutationLock.current) return
    mutationLock.current = true
    setBusy(label)
    setError(null)
    try { await action(); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The AI operation did not finish.') }
    finally { mutationLock.current = false; setBusy(null) }
  }

  const pause = () => void mutate(stats?.paused ? 'Resuming AI processing…' : 'Pausing AI processing…', async () => {
    const settings = await getAdminSettings()
    await updateAdminSettings({ aiProcessingPaused: !settings.aiProcessingPaused })
  })

  const reindexAll = () => {
    if (!window.confirm('Queue a fresh AI analysis for up to 200 approved memories? Repeat only after this batch drains.')) return
    void mutate('Queuing a bounded full re-index batch…', () => backfillAdminAi('all'))
  }

  const cards = stats ? [
    ['Eligible media', stats.totalEligible, BrainCircuit],
    ['AI indexed', stats.indexed, CheckCircle2],
    ['Queued', stats.queued + stats.processing, Clock3],
    ['Failed', stats.failed, AlertTriangle],
    ['Categorised', stats.categorised, Tags],
    ['Face-indexed photos', stats.faceIndexedPhotos, ScanFace],
    ['Detected faces', stats.detectedFaces, ScanFace],
    ['Semantic vectors', stats.semanticIndexed, Search],
  ] as const : []

  return (
    <div className="admin-ai-panel">
      <div className="admin-section-heading"><div><p className="eyebrow">AI & discovery</p><h1>Memory intelligence.</h1></div><p>Background jobs remain independent: a provider failure never hides ordinary gallery media.</p></div>
      {error ? <div className="moderation-notice moderation-notice--error" role="alert"><AlertTriangle /><span>{error}</span><button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
      {busy ? <div className="moderation-notice" role="status"><LoaderCircle className="spin" /><span>{busy}</span></div> : null}
      {!stats ? <div className="admin-state"><LoaderCircle className="spin" />Loading AI operations…</div> : <>
        <div className="stats-grid">{cards.map(([label,value,Icon]) => <article key={label}><Icon aria-hidden="true" /><span>{label}</span><strong>{value.toLocaleString()}</strong></article>)}</div>
        <section className="admin-operation-card"><div><p className="settings-card-label">Processing controls</p><h2>{stats.paused ? 'AI processing is paused.' : 'AI processing is active.'}</h2><p>Backfills are capped and dispatched gradually through the durable outbox and Queue.</p></div><div className="admin-operation-actions"><button className="button button-secondary" type="button" onClick={pause} disabled={Boolean(busy)}>{stats.paused ? <Play /> : <Pause />}{stats.paused ? 'Resume AI' : 'Pause AI'}</button><button className="button button-primary" type="button" onClick={() => void mutate('Queuing unprocessed media…', () => backfillAdminAi('unprocessed'))} disabled={Boolean(busy)}><BrainCircuit />Process remaining</button><button className="button button-secondary" type="button" onClick={() => void mutate('Re-queuing failed media…', () => backfillAdminAi('failed'))} disabled={Boolean(busy)}><RotateCcw />Retry failed media</button><button className="button button-secondary" type="button" onClick={reindexAll} disabled={Boolean(busy)}><RotateCcw />Re-index all (200)</button><button className="button button-secondary" type="button" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw />Refresh</button></div></section>
        <section className="admin-operation-card"><div><p className="settings-card-label">Find Me calibration</p><h2>Thresholds are model-specific.</h2><p>Inspect comparison scores before enabling a production provider. A production face index is intentionally absent until the actual model dimensions and metric are documented.</p></div><Link className="button button-secondary" to="/admin/ai/face-calibration"><ScanFace />Open calibration tool</Link></section>
        <section className="admin-job-card"><div className="admin-card-heading"><div><p className="settings-card-label">Recent jobs</p><h2>Queue activity</h2></div><span>{jobs.length} shown</span></div>{jobs.length ? <div className="admin-job-list">{jobs.map((job) => <article key={job.id}><div><strong>{job.type.replaceAll('_',' ')}</strong><small>{job.id} · attempt {job.attemptCount} · {new Date(job.updatedAt).toLocaleString()}</small>{job.lastErrorCode ? <p>{job.lastErrorCode}: {job.lastErrorMessage || 'No safe detail available.'}</p> : null}</div><b className={`job-status job-status--${job.status}`}>{job.status}</b>{['failed','partial'].includes(job.status) ? <button type="button" onClick={() => void mutate('Retrying job…', () => updateAdminAiJob(job.id,'retry'))} aria-label={`Retry ${job.type.replaceAll('_',' ')} job ${job.id}`}><RotateCcw /></button> : null}{['failed','partial'].includes(job.status) ? <button type="button" onClick={() => void mutate('Dismissing job…', () => updateAdminAiJob(job.id,'dismiss'))} aria-label={`Dismiss ${job.type.replaceAll('_',' ')} job ${job.id}`}><X /></button> : null}</article>)}</div> : <p className="admin-empty-copy">No recent jobs.</p>}</section>
        <section className="admin-danger-card"><div><p className="settings-card-label">Irreversible privacy control</p><h2>Purge every face vector</h2><p>Disable Find Me first. This removes face vectors and D1 embedding references while retaining ordinary media, categories, and semantic search.</p></div><label><span>Type PURGE FACE INDEX</span><input value={purgeConfirmation} onChange={(event) => setPurgeConfirmation(event.target.value)} /></label><button className="button" type="button" disabled={purgeConfirmation !== 'PURGE FACE INDEX' || Boolean(busy)} onClick={() => void mutate('Queuing face-index purge…', async () => { await purgeFaceIndex(purgeConfirmation); setPurgeConfirmation('') })}><Trash2 />Purge face index</button></section>
      </>}
    </div>
  )
}
