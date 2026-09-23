import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUpRight, LoaderCircle } from 'lucide-react'
import type { Greeting } from '../../../shared/contracts'
import { useLocale } from '../../context/useLocale'
import { guestbookCopy } from '../../i18n/guestbook'
import { getGreetings } from '../../services/api'
import { GreetingComposer } from './GreetingComposer'

export function Guestbook({ onLeaveGreeting }: { onLeaveGreeting?: () => void }) {
  const { locale } = useLocale()
  const t = guestbookCopy[locale]
  const [items, setItems] = useState<Greeting[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [submissionsOpen, setSubmissionsOpen] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)
  const requestVersion = useRef(0)
  const loadLock = useRef(false)

  const load = useCallback(async (nextCursor?: string) => {
    if (loadLock.current) return
    loadLock.current = true
    const version = ++requestVersion.current
    const append = Boolean(nextCursor)
    if (append) { setLoadingMore(true); setMoreError(false) }
    else { setLoading(true); setError(false) }
    try {
      const page = await getGreetings({ cursor: nextCursor, limit: 6 })
      if (version !== requestVersion.current) return
      setItems((current) => append ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))] : page.items)
      setCursor(page.nextCursor)
      setSubmissionsOpen(page.submissionsOpen)
    } catch {
      if (version === requestVersion.current) {
        if (append) setMoreError(true)
        else setError(true)
      }
    } finally {
      if (version === requestVersion.current) {
        loadLock.current = false
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => { window.clearTimeout(timer); requestVersion.current += 1; loadLock.current = false }
  }, [load])

  return (
    <section className="guestbook section-shell" id="guestbook" aria-labelledby="guestbook-title">
      <div className="guestbook-heading">
        <div><p className="eyebrow">{t.eyebrow}</p><h2 id="guestbook-title">{t.title}</h2></div>
        <div className="guestbook-intro"><p>{t.intro}</p>{submissionsOpen ? <button type="button" className="guestbook-write-link" onClick={onLeaveGreeting ?? (() => setComposerOpen(true))}>{t.leave}<ArrowUpRight size={17} aria-hidden="true" /></button> : <p className="guestbook-closed" role="status">{t.closed}</p>}</div>
      </div>
      {loading ? <div className="guestbook-state" role="status"><LoaderCircle className="spin" aria-hidden="true" />{t.loading}</div> : error ? <div className="guestbook-state" role="alert"><p>{t.loadError}</p><button type="button" className="button button-secondary" onClick={() => void load()}>{t.retry}</button></div> : items.length ? <div className="guestbook-grid">{items.map((item, index) => <article className="greeting-card" key={item.id}><span className="greeting-card-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><blockquote>{item.message}</blockquote><footer><span className="greeting-card-line" aria-hidden="true" /><span>{item.guestName || t.anonymous}</span></footer></article>)}</div> : <div className="guestbook-state guestbook-empty"><h3>{t.empty}</h3><p>{t.emptyBody}</p></div>}
      {!loading && !error && cursor ? <div className="guestbook-more">{moreError ? <p role="alert">{t.loadError}</p> : null}<button className="button button-secondary" type="button" disabled={loadingMore} onClick={() => void load(cursor)}>{loadingMore ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}{loadingMore ? t.loadingMore : moreError ? t.retry : t.more}</button></div> : null}
      {!onLeaveGreeting ? <GreetingComposer open={composerOpen} onClose={() => setComposerOpen(false)} /> : null}
    </section>
  )
}
