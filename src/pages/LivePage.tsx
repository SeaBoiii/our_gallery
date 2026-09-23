import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Expand, ImageOff, Minimize, Pause, Plane, Play, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { EventSlug, GalleryMedia, PublicGalleryConfig } from '../../shared/contracts'
import { LanguageToggle } from '../components/LanguageToggle'
import { PUBLIC_GALLERY_URL } from '../config'
import { getGallery, getLiveConfig } from '../services/api'
import { useLocale } from '../context/useLocale'
import { useGalleryVisibility } from '../context/useGalleryVisibility'
import { copy } from '../i18n/copy'
import { WeddingMonogram } from '../components/WeddingMonogram'
import { eventDateLabel, galleryDateLabel } from '../utils/date'

type Source = 'all' | EventSlug
const JOURNAL_LAYOUTS = 6

function LiveScrap({ item, position }: { item: GalleryMedia; position: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <figure className={`live-scrap live-scrap--${position}`} aria-hidden="true">
    <img src={item.thumbnailUrl || item.displayUrl} alt="" decoding="async" onError={() => setFailed(true)} />
    <figcaption>A <i>&amp;</i> N <span>·</span> {String(position + 1).padStart(2, '0')}</figcaption>
  </figure>
}

/** Freeze a spread's selection while it is on screen, but never retain revoked media. */
function LiveCompanions({ items, currentId, recent }: { items: GalleryMedia[]; currentId: string; recent: string[] }) {
  const [ids] = useState(() => {
    const eligible = new Set(items.filter(item => item.mediaType === 'photo' && item.id !== currentId).map(item => item.id))
    return [...new Set([...recent].reverse().concat([...eligible]))].filter(id => eligible.has(id)).slice(0, 2)
  })
  return ids.map((id, position) => {
    const item = items.find(candidate => candidate.id === id && candidate.mediaType === 'photo' && candidate.id !== currentId)
    return item ? <LiveScrap key={`${id}:${item.thumbnailUrl || item.displayUrl}`} item={item} position={position} /> : null
  })
}

const wallCopy = {
  en: { wedding: 'Our Wedding', wall: 'The live memory wall', pause: 'Pause slideshow', resume: 'Resume slideshow', paused: 'Slideshow paused', share: 'A little of your day. A part of our story.', forever: 'Forever', controls: 'Slideshow controls', fullscreenError: 'Fullscreen could not be opened. You can continue viewing here.' },
  ms: { wedding: 'Perkahwinan Kami', wall: 'Paparan kenangan langsung', pause: 'Jeda tayangan', resume: 'Sambung tayangan', paused: 'Tayangan dijeda', share: 'Sedikit daripada hari anda. Sebahagian daripada kisah kami.', forever: 'Selamanya', controls: 'Kawalan tayangan', fullscreenError: 'Skrin penuh tidak dapat dibuka. Anda boleh terus menonton di sini.' },
}

function LiveBrand({ config }: { config: PublicGalleryConfig | null }) {
  const { locale } = useLocale()
  return <div className="live-brand">
    <div className="live-brand-mark"><WeddingMonogram compact /></div>
    <div><p className="live-brand-kicker">{wallCopy[locale].wedding}<span aria-hidden="true"> / </span>{copy[locale].live.flightMemories}</p><h1>Aleem <em>&amp;</em> Nurulain</h1><p className="live-date">{galleryDateLabel(config?.mode ?? null, locale)}</p></div>
  </div>
}

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
  const { config, status, refresh } = useGalleryVisibility()
  const { locale } = useLocale()
  if (!config) return <main className="live-wall live-wall--waiting"><div className="live-sky" aria-hidden="true" /><header className="live-header"><LiveBrand config={null} /><LanguageToggle /></header><section className="live-empty" role={status === 'error' ? 'alert' : 'status'}><Plane aria-hidden="true" /><p className="eyebrow">{wallCopy[locale].wall}</p><h2>{wallCopy[locale].wedding}</h2><p>{status === 'error' ? (locale === 'en' ? 'The gallery is temporarily unavailable.' : 'Galeri tidak tersedia buat sementara waktu.') : copy[locale].preparing}</p>{status === 'error' ? <button type="button" onClick={() => void refresh().catch(() => undefined)}><RefreshCw size={16} aria-hidden="true" />{copy[locale].tryAgain}</button> : null}</section></main>
  return <ConfiguredLivePage key={`${config.mode}|${config.revision}`} config={config} />
}

function ConfiguredLivePage({ config }: { config: PublicGalleryConfig }) {
  const { locale } = useLocale()
  const t = copy[locale].live
  const w = wallCopy[locale]
  const [items, setItems] = useState<GalleryMedia[]>([])
  const [source, setSource] = useState<Source>(config.mode === 'both' ? 'all' : config.mode)
  const [current, setCurrent] = useState<GalleryMedia | null>(null)
  const [layout, setLayout] = useState({ index: 0, recent: [] as string[] })
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const [paused, setPaused] = useState(() => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  const [controlError, setControlError] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const recent = useRef<string[]>([])
  const sourceRef = useRef<Source>(source)
  const refreshSequence = useRef(0)
  useEffect(() => () => { refreshSequence.current += 1 }, [])

  const refresh = useCallback(async () => {
    const requestedSource = source
    const sequence = ++refreshSequence.current
    try {
      const page = await getGallery({ event: requestedSource === 'all' ? undefined : requestedSource, limit: 50 })
      if (sequence !== refreshSequence.current || sourceRef.current !== requestedSource) return
      const visible = page.items.filter(item => (config.mode === 'both' || item.event.slug === config.mode) && (requestedSource === 'all' || item.event.slug === requestedSource))
      setItems(visible)
      setCurrent((previous) => visible.find((item) => item.id === previous?.id) || chooseNext(visible,recent.current) || null)
      setError(null)
    } catch {
      if (sequence !== refreshSequence.current || sourceRef.current !== requestedSource) return
      refreshSequence.current += 1
      setItems([])
      setCurrent(null)
      setError(t.reconnecting)
    }
  }, [source, t.reconnecting, config.mode])

  const selectSource = useCallback((nextSource: Source) => {
    nextSource = config.mode === 'both' ? nextSource : config.mode
    if (sourceRef.current === nextSource) return
    sourceRef.current = nextSource
    refreshSequence.current += 1
    recent.current = []
    setLayout({ index: 0, recent: [] })
    setSource(nextSource)
    setItems([])
    setCurrent(null)
  }, [config.mode])

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(),0)
    const timer = window.setInterval(() => void refresh(), 20_000)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [refresh])

  useEffect(() => {
    let active = true
    const sync = async () => {
      try { const live = await getLiveConfig(); if (active) selectSource(live.source) }
      catch { if (active) { refreshSequence.current += 1; setItems([]); setCurrent(null); setError(t.reconnecting) } }
    }
    const first = window.setTimeout(() => void sync(),0)
    const timer = window.setInterval(() => void sync(),30_000)
    return () => { active = false; window.clearTimeout(first); window.clearInterval(timer) }
  }, [selectSource, t.reconnecting])

  useEffect(() => {
    if (paused || items.length < 2 || !current) return

    let cancelled = false
    const sequence = refreshSequence.current
    const nextReady = findPreloadedNext(items, recent.current, current.id)
    const timer = window.setTimeout(() => {
      void nextReady.then((next) => {
        if (cancelled || !next || sequence !== refreshSequence.current) return
        const historySize = Math.min(8, Math.max(1, items.length - 1))
        const history = [...recent.current, current.id].slice(-historySize)
        recent.current = history
        setCurrent(next)
        setLayout((value) => ({ index: (value.index + 1) % JOURNAL_LAYOUTS, recent: history }))
      })
    }, current.mediaType === 'video' ? 16_000 : 9_000)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [current, items, paused])

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => { if (event.matches) setPaused(true) }
    preference?.addEventListener('change', onChange)
    return () => preference?.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (paused) video.pause()
    else void video.play().catch(() => undefined)
  }, [current, paused])

  useEffect(() => {
    const handler = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = async () => {
    setControlError(false)
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch { setControlError(true) }
  }

  return (
    <main className={`live-wall live-layout-${layout.index}`}>
      <div className="live-sky" aria-hidden="true" />
      <header className="live-header">
        <LiveBrand config={config} />
        <div className="live-controls" role="group" aria-label={w.controls}>
          {config.mode === 'both' ? <div className="live-sources" role="group" aria-label={t.source}>
            {([['all', t.all], ['solemnisation', t.dayOne], ['reception', t.dayTwo]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={source === value} onClick={() => selectSource(value)}>{label}</button>)}
          </div> : null}
          <div className="live-playback"><button type="button" className="live-icon-button" onClick={() => setPaused(value => !value)} aria-label={paused ? w.resume : w.pause} title={paused ? w.resume : w.pause}>{paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}</button><LanguageToggle /><button type="button" className="live-icon-button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? t.exitFullscreen : t.enterFullscreen} title={fullscreen ? t.exitFullscreen : t.enterFullscreen}>{fullscreen ? <Minimize size={18} aria-hidden="true" /> : <Expand size={18} aria-hidden="true" />}</button></div>
        </div>
        {controlError ? <p className="live-control-error" role="alert">{w.fullscreenError}</p> : null}
      </header>

      <div className="live-stage">
      {current ? (
        <section className={`live-memory${current.mediaType === 'video' ? ' live-memory--video' : ''}`} key={current.id} aria-label={w.wall}>
          <svg className="live-journal-route" viewBox="0 0 1000 700" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M65 560C150 655 440 610 390 440S660 70 855 145C965 190 905 350 825 300S940 50 970 75" /><circle cx="65" cy="560" r="6" /><circle cx="970" cy="75" r="6" /></svg>
          <div className="live-postmark" aria-hidden="true"><span>SINGAPORE</span><Plane strokeWidth={1} /><span>{w.forever}</span></div>
          <LiveCompanions items={items} currentId={current.id} recent={layout.recent} />
          <figure className="live-media">
            {current.mediaType === 'video' ? <video ref={videoRef} src={current.displayUrl} poster={current.thumbnailUrl} autoPlay={!paused} muted loop playsInline preload="auto" aria-label={current.guestMessage || `${t.memoryFrom} ${eventDateLabel(current.event.slug, locale)}`} /> : <img src={current.displayUrl} alt={current.guestMessage || `${t.memoryFrom} ${eventDateLabel(current.event.slug, locale)}`} />}
            <figcaption><span>{t.memoryLog}</span><Plane size={13} aria-hidden="true" /><span>A &amp; N</span></figcaption>
          </figure>
          <div className="live-caption" role="region" aria-label={locale === 'en' ? 'Memory caption' : 'Kapsyen kenangan'} tabIndex={0}>
            <p className="eyebrow">{eventDateLabel(current.event.slug, locale)}</p>
            <div className="live-caption-rule" aria-hidden="true"><i /><Plane size={17} /><i /></div>
            {current.guestMessage ? <blockquote className={current.guestMessage.length > 140 ? 'live-quote--long' : undefined}>&ldquo;{current.guestMessage}&rdquo;</blockquote> : <blockquote>{t.quoteOne}<br /><em>{t.quoteTwo}</em></blockquote>}
            {current.guestName ? <p className="live-credit"><span>{t.sharedBy}</span><strong>{current.guestName}</strong></p> : <p className="live-credit"><span>{w.wedding}</span><strong>Aleem &amp; Nurulain</strong></p>}
          </div>
        </section>
      ) : (
        <section className="live-empty" role={error ? 'alert' : 'status'}><ImageOff aria-hidden="true" /><p className="eyebrow">{t.memoryLog}</p><h2>{t.boardingOne}<br /><em>{t.boardingTwo}</em></h2><p>{error || t.approvedAppear}</p>{error ? <button type="button" onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />{t.reconnect}</button> : null}</section>
      )}

      <aside className="live-qr" aria-label={copy[locale].qr.aria}>
        <div className="live-qr-route" aria-hidden="true"><span>SIN</span><i /><Plane size={15} /><i /><span>∞</span></div>
        <div className="live-qr-code"><QRCodeSVG value={PUBLIC_GALLERY_URL} size={192} level="H" marginSize={4} bgColor="#fffdf8" fgColor="#081b31" title={copy[locale].qr.scanTitle} /></div>
        <div className="live-qr-copy"><p className="eyebrow">{t.scan}</p><p>{w.share}</p><span>{w.wedding}<i aria-hidden="true"> · </i>{w.forever}</span></div>
      </aside>
      </div>
      <footer className="live-footer"><span className="live-footer-label"><Plane size={15} aria-hidden="true" />{t.flightMemories}</span><a href={PUBLIC_GALLERY_URL}>gallery.aleemxnurul.love<ArrowUpRight size={14} aria-hidden="true" /></a><span className="live-status" role="status"><i aria-hidden="true" />{error || (paused ? w.paused : t.approved)}</span></footer>
    </main>
  )
}
