import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react'
import type { AdminGreeting, AdminGreetingStats, GreetingStatus } from '../../../shared/contracts'
import { deleteAdminGreeting, getAdminGreetings, getAdminGreetingStats, updateAdminGreetings } from '../../services/api'

type StatusFilter = Exclude<GreetingStatus, 'deleted'> | 'all'
const greetingDateFormatter = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' })

export function GreetingModerationPanel() {
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [items, setItems] = useState<AdminGreeting[]>([])
  const [stats, setStats] = useState<AdminGreetingStats | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutation, setMutation] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const mutationLock = useRef(false)
  const pageLock = useRef(false)

  const refreshStats = useCallback(async () => {
    try { setStats(await getAdminGreetingStats()) } catch { setStats(null) }
  }, [])

  const load = useCallback(async (nextCursor?: string) => {
    if (nextCursor && pageLock.current) return
    pageLock.current = true
    const version = ++requestVersion.current
    const append = Boolean(nextCursor)
    if (append) { setLoadingMore(true); setMoreError(false) }
    else { setLoading(true); setLoadError(false); setMoreError(false); setCursor(null); setSelected(new Set()) }
    try {
      const page = await getAdminGreetings({ status: status === 'all' ? undefined : status, cursor: nextCursor })
      if (version !== requestVersion.current) return
      setItems((current) => append ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))] : page.items)
      setCursor(page.nextCursor)
    } catch {
      if (version === requestVersion.current) {
        if (append) setMoreError(true)
        else setLoadError(true)
      }
    } finally {
      if (version === requestVersion.current) { pageLock.current = false; setLoading(false); setLoadingMore(false) }
    }
  }, [status])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); void refreshStats() }, 0)
    return () => { window.clearTimeout(timer); requestVersion.current += 1; pageLock.current = false }
  }, [load, refreshStats])

  const applyStatus = async (ids: string[], nextStatus: 'approved' | 'rejected') => {
    if (!ids.length || mutationLock.current) return
    mutationLock.current = true
    setMutation(`${nextStatus === 'approved' ? 'Approving' : 'Rejecting'} ${ids.length} ${ids.length === 1 ? 'greeting' : 'greetings'}…`)
    setMutationError(null)
    setNotice(null)
    try {
      const result = await updateAdminGreetings(ids, nextStatus)
      // Reload authoritative state; a concurrent moderator may have removed a selection.
      await load()
      await refreshStats()
      setNotice(`${result.updated} ${result.updated === 1 ? 'greeting' : 'greetings'} ${nextStatus}.`)
    } catch {
      setMutationError('The selected greetings could not be updated. Please try again; your selection is still here.')
    } finally { mutationLock.current = false; setMutation(null) }
  }

  const remove = async (item: AdminGreeting) => {
    if (mutationLock.current || !window.confirm('Delete this greeting? It will be removed from the guestbook and moderation queue.')) return
    mutationLock.current = true
    setMutation('Deleting greeting…')
    setMutationError(null)
    setNotice(null)
    try {
      const result = await deleteAdminGreeting(item.id)
      if (!result.deleted) throw new Error('Deletion was not confirmed.')
      await load()
      await refreshStats()
      setNotice('Greeting deleted.')
    } catch { setMutationError('The greeting could not be deleted. Please try again.') }
    finally { mutationLock.current = false; setMutation(null) }
  }

  const busy = Boolean(mutation)
  const controlsDisabled = busy || loading || loadingMore
  const toggleSelection = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else if (next.size < 100) next.add(id)
      return next
    })
  }
  return (
    <div className="greeting-moderation-panel">
      <div className="admin-section-heading"><div><p className="eyebrow">Guestbook</p><h1>Words worth keeping.</h1></div><p>Written wishes from both celebrations. Only approved greetings appear in the public guestbook.</p></div>
      {stats ? <div className="greeting-stats" aria-label="Greeting statistics"><span><strong>{stats.pending}</strong> Pending</span><span><strong>{stats.approved}</strong> Approved</span><span><strong>{stats.rejected}</strong> Rejected</span><span><strong>{stats.total}</strong> Total greetings</span></div> : null}
      <div className="moderation-toolbar"><div className="admin-filter-group">{(['pending', 'approved', 'rejected', 'all'] as const).map((value) => <button type="button" key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setNotice(null); setMutationError(null) }} disabled={busy}>{value}</button>)}</div><button type="button" className="refresh-button" aria-label="Refresh greetings" disabled={controlsDisabled} onClick={() => { void load(); void refreshStats() }}><RefreshCw className={loading ? 'spin' : undefined} aria-hidden="true" /></button></div>
      {selected.size ? <div className="batch-bar"><span>{selected.size} selected</span><button type="button" onClick={() => void applyStatus([...selected], 'approved')} disabled={controlsDisabled}><Check aria-hidden="true" />Approve selected</button><button type="button" onClick={() => void applyStatus([...selected], 'rejected')} disabled={controlsDisabled}><X aria-hidden="true" />Reject selected</button></div> : null}
      {selected.size === 100 ? <p className="moderation-notice" role="status">You can review up to 100 greetings at a time. Apply an action or deselect a greeting to choose another.</p> : null}
      {mutation ? <div className="moderation-notice" role="status"><LoaderCircle className="spin" aria-hidden="true" />{mutation}</div> : notice ? <p className="moderation-notice" role="status">{notice}</p> : null}
      {mutationError ? <p className="moderation-notice moderation-notice--error" role="alert">{mutationError}</p> : null}
      {loading ? <div className="admin-state" role="status"><LoaderCircle className="spin" aria-hidden="true" />Loading greetings…</div> : loadError ? <div className="admin-state" role="alert"><p>Greetings could not be loaded.</p><button type="button" className="button button-secondary" onClick={() => void load()}>Try again</button></div> : !items.length ? <div className="admin-state">No greetings match this filter.</div> : <div className="admin-greeting-list" aria-busy={busy}>{items.map((item) => <article className="admin-greeting" key={item.id}>
        <div className="admin-greeting-heading"><label><input type="checkbox" checked={selected.has(item.id)} disabled={controlsDisabled || (selected.size >= 100 && !selected.has(item.id))} onChange={() => toggleSelection(item.id)} /><span className="visually-hidden">Select greeting from {item.guestName || 'Anonymous guest'}</span></label><strong>{item.guestName || 'Anonymous guest'}</strong><span className={`status-pill status-${item.status}`}>{item.status}</span></div>
        <blockquote>{item.message}</blockquote><div className="admin-greeting-footer"><time dateTime={item.createdAt}>{greetingDateFormatter.format(new Date(item.createdAt))}</time><div><button type="button" onClick={() => void applyStatus([item.id], 'approved')} disabled={controlsDisabled || item.status === 'approved'} aria-label={`Approve greeting from ${item.guestName || 'Anonymous guest'}`}><Check size={16} aria-hidden="true" />Approve</button><button type="button" onClick={() => void applyStatus([item.id], 'rejected')} disabled={controlsDisabled || item.status === 'rejected'} aria-label={`Reject greeting from ${item.guestName || 'Anonymous guest'}`}><X size={16} aria-hidden="true" />Reject</button><button className="delete-action" type="button" onClick={() => void remove(item)} disabled={controlsDisabled} aria-label={`Delete greeting from ${item.guestName || 'Anonymous guest'}`}><Trash2 size={16} aria-hidden="true" /><span className="visually-hidden">Delete</span></button></div></div>
      </article>)}</div>}
      {!loading && !loadError && cursor ? <div className="moderation-pagination">{moreError ? <p role="alert">More greetings could not be loaded. Please try again.</p> : null}<button type="button" className="button button-secondary" disabled={controlsDisabled} onClick={() => void load(cursor)}>{loadingMore ? 'Loading greetings…' : moreError ? 'Try loading more again' : 'Load more greetings'}</button></div> : null}
    </div>
  )
}
