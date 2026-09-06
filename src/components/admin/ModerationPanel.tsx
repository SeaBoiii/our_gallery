import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, Check, Copy, Download, LoaderCircle, Play, RefreshCw, ScanFace, Trash2, TriangleAlert, X } from 'lucide-react'
import type { AdminMedia, EventSlug, GalleryCategory, MediaStatus } from '../../../shared/contracts'
import { PUBLIC_GALLERY_URL } from '../../config'
import { backfillAdminAi, deleteAdminMedia, getAdminMedia, getDiscoveryCategories, setAdminMediaFaceSearch, updateAdminMedia, updateAdminMediaCategory } from '../../services/api'
import { formatBytes } from '../../utils/files'

type Filters = { status: MediaStatus | 'all'; event: EventSlug | 'all'; type: 'photo' | 'video' | 'all'; category: string; minConfidence: string }

export function ModerationPanel() {
  const [items, setItems] = useState<AdminMedia[]>([])
  const [filters, setFilters] = useState<Filters>({ status: 'pending', event: 'all', type: 'all', category: '', minConfidence: '' })
  const [categories, setCategories] = useState<GalleryCategory[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paginationError, setPaginationError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutation, setMutation] = useState<{ ids: string[]; label: string } | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const mutationLock = useRef(false)
  const copyLock = useRef<string | null>(null)
  const copiedTimer = useRef<number | null>(null)
  const query = useMemo(() => ({ status: filters.status === 'all' ? undefined : filters.status, event: filters.event === 'all' ? undefined : filters.event, type: filters.type === 'all' ? undefined : filters.type, ...(filters.category ? { category:filters.category } : {}),...(filters.minConfidence ? { minConfidence:Number(filters.minConfidence) } : {}) }), [filters])
  const load = useCallback(async (nextCursor?: string) => {
    const append = Boolean(nextCursor)
    const requestId = ++requestVersion.current
    if (append) {
      setLoadingMore(true)
      setPaginationError(null)
    } else {
      setLoading(true)
      setError(null)
      setPaginationError(null)
      setCursor(null)
    }
    try {
      const page = await getAdminMedia({ ...query, cursor: nextCursor })
      if (requestId !== requestVersion.current) return
      setItems((current) => append ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))] : page.items)
      setCursor(page.nextCursor)
      if (!append) setSelected(new Set())
    } catch (reason) {
      if (requestId !== requestVersion.current) return
      const message = reason instanceof Error ? reason.message : 'Moderation queue could not be loaded.'
      if (append) setPaginationError(message)
      else setError(message)
    } finally {
      if (requestId === requestVersion.current) {
        if (append) setLoadingMore(false)
        else setLoading(false)
      }
    }
  }, [query])
  useEffect(() => { const timer = window.setTimeout(() => void load(),0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => { void getDiscoveryCategories().then(setCategories).catch(() => undefined) }, [])

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
  }, [])

  const applyStatus = async (ids: string[], status: 'approved' | 'rejected') => {
    if (!ids.length || mutationLock.current) return
    mutationLock.current = true
    setMutationError(null)
    setMutation({ ids, label: `${status === 'approved' ? 'Approving' : 'Rejecting'} ${ids.length} ${ids.length === 1 ? 'memory' : 'memories'}…` })
    try {
      await updateAdminMedia(ids, status)
      const changed = new Set(ids)
      setItems((current) => current
        .filter((item) => !changed.has(item.id) || filters.status === 'all' || filters.status === status)
        .map((item) => changed.has(item.id) ? { ...item, status } : item))
      setSelected(new Set())
    } catch (reason) {
      const detail = reason instanceof Error && reason.message ? ` ${reason.message}` : ''
      setMutationError(`The selected ${ids.length === 1 ? 'memory was' : 'memories were'} not updated.${detail}`)
    } finally {
      mutationLock.current = false
      setMutation(null)
    }
  }
  const remove = async (item: AdminMedia) => {
    if (mutationLock.current) return
    if (!window.confirm(`Permanently delete ${item.originalFilename} and all R2 variants? This cannot be undone.`)) return
    mutationLock.current = true
    setMutationError(null)
    setMutation({ ids: [item.id], label: `Deleting ${item.originalFilename}…` })
    try {
      await deleteAdminMedia(item.id)
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      setSelected((current) => { const next = new Set(current); next.delete(item.id); return next })
    } catch (reason) {
      const detail = reason instanceof Error && reason.message ? ` ${reason.message}` : ''
      setMutationError(`${item.originalFilename} was not deleted.${detail}`)
    } finally {
      mutationLock.current = false
      setMutation(null)
    }
  }
  const copyPublicLink = async (item: AdminMedia) => {
    if (copyLock.current || item.status !== 'approved') return
    copyLock.current = item.id
    setCopyingId(item.id)
    setMutationError(null)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.')
      const link = new URL('/gallery', PUBLIC_GALLERY_URL)
      link.searchParams.set('memory', item.id)
      await navigator.clipboard.writeText(link.toString())
      setCopiedId(item.id)
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopiedId(null), 2500)
    } catch (reason) {
      const detail = reason instanceof Error && reason.message ? ` ${reason.message}` : ''
      setMutationError(`The public media link could not be copied.${detail}`)
    } finally {
      copyLock.current = null
      setCopyingId(null)
    }
  }
  const toggle = (id: string) => {
    if (mutationLock.current) return
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  const reprocess = async (ids: string[]) => {
    if (!ids.length || mutationLock.current) return
    mutationLock.current = true; setMutation({ ids,label:`Queuing AI analysis for ${ids.length} memoriesâ€¦` });setMutationError(null)
    try { await backfillAdminAi('selected',ids); setSelected(new Set()) }
    catch (reason) { setMutationError(reason instanceof Error ? reason.message : 'AI analysis could not be queued.') }
    finally { mutationLock.current=false;setMutation(null) }
  }
  const toggleFace = async (item: AdminMedia) => {
    if (mutationLock.current) return
    mutationLock.current=true;setMutation({ ids:[item.id],label:'Updating Find Me privacyâ€¦' });setMutationError(null)
    try { const result=await setAdminMediaFaceSearch(item.id,!item.faceSearchEnabled);setItems((current)=>current.map((candidate)=>candidate.id===item.id?{...candidate,faceSearchEnabled:result.faceSearchEnabled}:candidate)) }
    catch (reason) { setMutationError(reason instanceof Error ? reason.message : 'Find Me privacy could not be updated.') }
    finally { mutationLock.current=false;setMutation(null) }
  }
  const categoryAction = async (item: AdminMedia,action:'add'|'remove'|'suppress',categorySlug:string) => {
    if (mutationLock.current || !categorySlug) return
    mutationLock.current=true;setMutation({ ids:[item.id],label:'Updating categoriesâ€¦' });setMutationError(null)
    try { await updateAdminMediaCategory(item.id,action,categorySlug);await load() }
    catch (reason) { setMutationError(reason instanceof Error ? reason.message : 'Categories could not be updated.') }
    finally { mutationLock.current=false;setMutation(null) }
  }

  const mutationIds = new Set<string>(mutation?.ids ?? [])

  return (
    <div className="moderation-panel">
      <div className="admin-section-heading"><div><p className="eyebrow">Moderation</p><h1>Memory arrivals.</h1></div><p>Only approved memories can enter the public gallery or live wall.</p></div>
      <div className="moderation-toolbar">
        <div className="admin-filter-group">{(['pending','approved','rejected','all'] as const).map((status) => <button type="button" key={status} aria-pressed={filters.status === status} onClick={() => setFilters({ ...filters, status })} disabled={Boolean(mutation)}>{status}</button>)}</div>
        <select aria-label="Filter by celebration" value={filters.event} onChange={(event) => setFilters({ ...filters, event: event.target.value as Filters['event'] })} disabled={Boolean(mutation)}><option value="all">Both days</option><option value="solemnisation">Day 1</option><option value="reception">Day 2</option></select>
        <select aria-label="Filter by media type" value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value as Filters['type'] })} disabled={Boolean(mutation)}><option value="all">Photos & videos</option><option value="photo">Photos</option><option value="video">Videos</option></select>
        <select aria-label="Filter by category" value={filters.category} onChange={(event) => setFilters({ ...filters,category:event.target.value })} disabled={Boolean(mutation)}><option value="">All categories</option>{categories.map((category)=><option key={category.id} value={category.slug}>{category.displayName}</option>)}</select>
        <select aria-label="Minimum AI confidence" value={filters.minConfidence} onChange={(event) => setFilters({ ...filters,minConfidence:event.target.value })} disabled={Boolean(mutation) || !filters.category}><option value="">Any confidence</option><option value="0.7">70%+</option><option value="0.85">85%+</option><option value="0.95">95%+</option></select>
        <button type="button" className="refresh-button" onClick={() => void load()} aria-label="Refresh moderation queue" disabled={loading || loadingMore || Boolean(mutation)}><RefreshCw className={loading ? 'spin' : undefined} aria-hidden="true" /></button>
      </div>
      {selected.size ? <div className="batch-bar"><span>{selected.size} selected</span><button type="button" onClick={() => void applyStatus([...selected], 'approved')} disabled={Boolean(mutation)}><Check aria-hidden="true" />Approve</button><button type="button" onClick={() => void applyStatus([...selected], 'rejected')} disabled={Boolean(mutation)}><X aria-hidden="true" />Reject</button><button type="button" onClick={() => void reprocess([...selected])} disabled={Boolean(mutation)}><BrainCircuit aria-hidden="true" />Reprocess AI</button></div> : null}
      {mutation ? <div className="moderation-notice" role="status"><LoaderCircle className="spin" aria-hidden="true" /><span>{mutation.label}</span></div> : null}
      {mutationError ? <div className="moderation-notice moderation-notice--error" role="alert"><TriangleAlert aria-hidden="true" /><span>{mutationError}</span><button type="button" onClick={() => setMutationError(null)}>Dismiss</button></div> : null}
      {error ? <div className="admin-state" role="alert">{error}</div> : null}
      {loading ? <div className="admin-state"><LoaderCircle className="spin" aria-hidden="true" />Loading arrivals…</div> : null}
      {!loading && !error ? (
        <div className="moderation-grid" aria-busy={Boolean(mutation)}>
          {items.map((item) => (
            <article key={item.id} className={`${selected.has(item.id) ? 'is-selected ' : ''}${mutationIds.has(item.id) ? 'is-busy' : ''}`} aria-busy={mutationIds.has(item.id)}>
              <label className="media-select"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} disabled={Boolean(mutation)} /><span aria-hidden="true"><Check /></span><span className="visually-hidden">Select {item.originalFilename}</span></label>
              <div className="moderation-media">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.guestMessage || `Upload from ${item.eventDisplayName}`} /> : <span>No preview</span>}{item.mediaType === 'video' ? <i><Play aria-hidden="true" fill="currentColor" /></i> : null}<b className={`status-pill status-${item.status}`}>{item.status}</b></div>
              <div className="moderation-copy"><p><span>{item.eventSlug === 'solemnisation' ? '21 Aug' : '22 Aug'} · {item.mediaType}</span><strong>{item.guestName || 'Anonymous guest'}</strong></p>{item.guestMessage ? <blockquote>“{item.guestMessage}”</blockquote> : null}{item.ai?.caption ? <div className="admin-ai-caption"><span>AI caption · {item.ai.overallStatus}</span><p>{item.ai.caption}</p></div> : null}{item.categories?.length ? <div className="admin-category-chips">{item.categories.map((category)=>{ const action=category.source === 'admin' ? 'Remove manual category' : 'Suppress AI category'; return <button key={`${category.id}:${category.source}`} type="button" aria-label={`${action} ${category.displayName} from ${item.originalFilename}`} onClick={()=>void categoryAction(item,category.source==='admin'?'remove':'suppress',category.slug)}>{category.displayName}{typeof category.confidence==='number'?` ${Math.round(category.confidence*100)}%`:''} <X aria-hidden="true" /></button> })}</div>:null}<select className="admin-category-add" aria-label={`Add category to ${item.originalFilename}`} defaultValue="" onChange={(event)=>{ const slug=event.target.value;event.target.value='';void categoryAction(item,'add',slug) }}><option value="" disabled>Add category…</option>{categories.filter((category)=>!item.categories?.some((existing)=>existing.slug===category.slug&&existing.source==='admin')).map((category)=><option key={category.id} value={category.slug}>{category.displayName}</option>)}</select><button className={`face-media-toggle${item.faceSearchEnabled?' is-enabled':''}`} type="button" aria-pressed={item.faceSearchEnabled} onClick={()=>void toggleFace(item)}><ScanFace aria-hidden="true" />{item.faceSearchEnabled?'Included in Find Me':'Excluded from Find Me'}</button><small>{item.originalFilename} · {formatBytes(item.sizeBytes)} · Derivatives: {item.derivativeStatus}</small></div>
              <div className="moderation-actions"><button type="button" onClick={() => void applyStatus([item.id], 'approved')} aria-label="Approve" disabled={Boolean(mutation) || item.status === 'approved'}><Check /></button><button type="button" onClick={() => void applyStatus([item.id], 'rejected')} aria-label="Reject" disabled={Boolean(mutation) || item.status === 'rejected'}><X /></button>{item.status === 'approved' ? <button className="copy-action" type="button" onClick={() => void copyPublicLink(item)} aria-label={copiedId === item.id ? 'Public link copied' : 'Copy approved media link'} disabled={copyingId === item.id || Boolean(mutation)}>{copyingId === item.id ? <LoaderCircle className="spin" /> : copiedId === item.id ? <Check /> : <Copy />}</button> : null}{item.originalDownloadUrl ? <a href={item.originalDownloadUrl} download={item.originalFilename} aria-label="Download original"><Download /></a> : null}<button className="delete-action" type="button" onClick={() => void remove(item)} aria-label="Delete" disabled={Boolean(mutation)}><Trash2 /></button></div>
            </article>
          ))}
        </div>
      ) : null}
      {!loading && !error && !items.length ? <div className="admin-state">No memories match these filters.</div> : null}
      {!loading && !error && items.length ? <div className="moderation-pagination"><p>Showing {items.length.toLocaleString()} {items.length === 1 ? 'memory' : 'memories'}</p>{paginationError ? <span role="alert">{paginationError}</span> : null}{cursor ? <button type="button" className="button button-secondary" onClick={() => void load(cursor)} disabled={loadingMore || Boolean(mutation)}>{loadingMore ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{loadingMore ? 'Loading more…' : paginationError ? 'Try loading more again' : 'Load more arrivals'}</button> : <small>End of the current results</small>}</div> : null}
    </div>
  )
}
