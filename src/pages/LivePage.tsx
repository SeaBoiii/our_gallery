import { useCallback, useEffect, useRef, useState } from 'react'
import { Expand, ImageOff, Minimize, RefreshCw } from 'lucide-react'
import type { EventSlug, GalleryMedia } from '../../shared/contracts'
import { QRCodeCard } from '../components/QRCodeCard'
import { getGallery, getLiveConfig } from '../services/api'
import { useLocale } from '../context/useLocale'
import { copy } from '../i18n/copy'
import { WeddingMonogram } from '../components/WeddingMonogram'

type Source = 'all' | EventSlug

function chooseNext(items: GalleryMedia[], recent: string[], current?: string) {
  const available = items.filter((item) => item.id !== current && !recent.includes(item.id))
  const pool = available.length ? available : items.filter((item) => item.id !== current)
  return pool[Math.floor(Math.random() * Math.max(1, pool.length))] || items[0]
}

function preloadMedia(item: GalleryMedia): Promise<boolean> {
  if (!item.displayUrl) return Promise.resolve(false)

  return new Promise((resolve) => {
    let settled = false
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      resolve(ready)
    }
    const timeout = window.setTimeout(() => finish(false), 8_000)

    if (item.mediaType === 'photo') {
      const image = new Image()
      image.onload = () => finish(true)
      image.onerror = () => finish(false)
      image.src = item.displayUrl
      if (image.complete) finish(image.naturalWidth > 0)
      return
    }

    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.onloadedmetadata = () => finish(true)
    video.onerror = () => finish(false)
    video.src = item.displayUrl
    video.load()
  })
}

async function findPreloadedNext(items: GalleryMedia[], recent: string[], currentId: string) {
  const attempted = new Set<string>()

  while (attempted.size < items.length - 1) {
    const remaining = items.filter((item) => !attempted.has(item.id))
    const candidate = chooseNext(remaining, recent, currentId)
    if (!candidate || candidate.id === currentId) return null
    if (await preloadMedia(candidate)) return candidate
    attempted.add(candidate.id)
  }

  return null
}

export default function LivePage() {
  const { locale } = useLocale()
  const t = copy[locale].live
  const eventCopy = copy[locale].upload
  const [items, setItems] = useState<GalleryMedia[]>([])
  const [source, setSource] = useState<Source>('all')
  const [current, setCurrent] = useState<GalleryMedia | null>(null)
  const [layout, setLayout] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const recent = useRef<string[]>([])
  const sourceRef = useRef<Source>(source)
  const refreshSequence = useRef(0)

  const refresh = useCallback(async () => {
    const requestedSource = source
    const sequence = ++refreshSequence.current
    try {
      const page = await getGallery({ event: requestedSource === 'all' ? undefined : requestedSource, limit: 50 })
      if (sequence !== refreshSequence.current || sourceRef.current !== requestedSource) return
      setItems(page.items)
      setCurrent((previous) => page.items.find((item) => item.id === previous?.id) || chooseNext(page.items,recent.current) || null)
      setError(null)
    } catch {
      if (sequence !== refreshSequence.current || sourceRef.current !== requestedSource) return
      setError(t.reconnecting)
    }
  }, [source, t.reconnecting])

  const selectSource = useCallback((nextSource: Source) => {
    if (sourceRef.current === nextSource) return
    sourceRef.current = nextSource
    refreshSequence.current += 1
    recent.current = []
    setSource(nextSource)
    setItems([])
    setCurrent(null)
  }, [])

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(),0)
    const timer = window.setInterval(() => void refresh(), 20_000)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [refresh])

  useEffect(() => {
    const sync = async () => {
      try { const config = await getLiveConfig(); selectSource(config.source) } catch { /* Keep the last working source. */ }
    }
    const first = window.setTimeout(() => void sync(),0)
    const timer = window.setInterval(() => void sync(),30_000)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [selectSource])

  useEffect(() => {
    if (items.length < 2 || !current) return

    let cancelled = false
    const nextReady = findPreloadedNext(items, recent.current, current.id)
    const timer = window.setTimeout(() => {
      void nextReady.then((next) => {
        if (cancelled || !next) return
        const historySize = Math.min(8, Math.max(1, items.length - 1))
        recent.current = [...recent.current, current.id].slice(-historySize)
        setCurrent(next)
        setLayout((value) => (value + 1) % 3)
      })
    }, current.mediaType === 'video' ? 16_000 : 9_000)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [current, items])

  useEffect(() => {
    const handler = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  }

  return (
    <main className={`live-wall live-layout-${layout}`}>
      <div className="live-clouds" aria-hidden="true" />
      <header className="live-header">
        <div className="live-brand">
          <div className="live-brand-mark"><WeddingMonogram compact label="Aleem and Nurul" /></div>
          <span>{t.flightMemories} · AN-210827</span>
        </div>
        <div className="live-controls">
          <div aria-label={t.source}>
            {([['all', t.all], ['solemnisation', t.dayOne], ['reception', t.dayTwo]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={source === value} onClick={() => selectSource(value)}>{label}</button>)}
          </div>
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? t.exitFullscreen : t.enterFullscreen}>{fullscreen ? <Minimize aria-hidden="true" /> : <Expand aria-hidden="true" />}</button>
        </div>
      </header>

      {current ? (
        <section className="live-memory" key={current.id} aria-live="polite">
          <div className="live-media">
            {current.mediaType === 'video' ? <video src={current.displayUrl} poster={current.thumbnailUrl} autoPlay muted loop playsInline preload="auto" /> : <img src={current.displayUrl} alt={current.guestMessage || `${t.memoryFrom} ${current.event.slug === 'solemnisation' ? eventCopy.solemnisation : eventCopy.reception}`} />}
          </div>
          <div className="live-caption">
            <p className="eyebrow">{current.event.slug === 'solemnisation' ? eventCopy.dateOne : eventCopy.dateTwo} · {current.event.slug === 'solemnisation' ? eventCopy.solemnisation : eventCopy.reception}</p>
            {current.guestMessage ? <blockquote>“{current.guestMessage}”</blockquote> : <blockquote>{t.quoteOne}<br />{t.quoteTwo}</blockquote>}
            {current.guestName ? <p>{t.sharedBy} {current.guestName}</p> : null}
          </div>
        </section>
      ) : (
        <section className="live-empty"><ImageOff aria-hidden="true" /><p className="eyebrow">{t.memoryLog}</p><h1>{t.boardingOne}<br />{t.boardingTwo}</h1><p>{error || t.approvedAppear}</p>{error ? <button type="button" onClick={() => void refresh()}><RefreshCw aria-hidden="true" />{t.reconnect}</button> : null}</section>
      )}

      <aside className="live-qr"><QRCodeCard compact /></aside>
      <footer className="live-footer"><span>{t.scan}</span><strong>gallery.aleemxnurul.love</strong><span>{error || t.approved}</span></footer>
    </main>
  )
}
