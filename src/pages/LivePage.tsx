import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { ArrowUpRight, Expand, ImageOff, Minimize, Pause, Plane, Play, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useInRouterContext, useLocation } from 'react-router-dom'
import type { EventSlug, GalleryMedia, PublicGalleryConfig } from '../../shared/contracts'
import { LanguageToggle } from '../components/LanguageToggle'
import { PUBLIC_GALLERY_URL } from '../config'
import { getGallery, getLiveConfig } from '../services/api'
import { useLocale } from '../context/useLocale'
import { useGalleryVisibility } from '../context/useGalleryVisibility'
import { copy } from '../i18n/copy'
import { WeddingMonogram } from '../components/WeddingMonogram'
import { eventDateLabel, flightCode, galleryDateLabel } from '../utils/date'

type Source = 'all' | EventSlug
type QrSide = 'left' | 'right'
const SLIDE_MS = 9_000
const IDLE_MS = 3_000

function qrSideFromSearch(search: string): QrSide {
  return new URLSearchParams(search).get('qr') === 'left' ? 'left' : 'right'
}

function subscribeToSearch(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

const currentSearch = () => window.location.search

const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

const wallCopy = {
  en: { wedding: 'Our Wedding', wall: 'The live memory wall', pause: 'Pause slideshow', resume: 'Resume slideshow', paused: 'Slideshow paused', share: 'Scan to add your photos', forever: 'Forever', controls: 'Slideshow controls', fullscreenError: 'Fullscreen could not be opened. You can continue viewing here.', noAccount: 'No app or account needed.', boardingPass: 'Boarding pass', print: 'Memory', justLanded: 'Just landed', latest: 'Latest arrivals', landed: (count: string) => `${count} ${count === '1' ? 'memory has' : 'memories have'} landed` },
  ms: { wedding: 'Perkahwinan Kami', wall: 'Paparan kenangan langsung', pause: 'Jeda tayangan', resume: 'Sambung tayangan', paused: 'Tayangan dijeda', share: 'Imbas untuk menambah foto anda', forever: 'Selamanya', controls: 'Kawalan tayangan', fullscreenError: 'Skrin penuh tidak dapat dibuka. Anda boleh terus menonton di sini.', noAccount: 'Tanpa aplikasi atau akaun.', boardingPass: 'Pas masuk', print: 'Kenangan', justLanded: 'Baru tiba', latest: 'Ketibaan terkini', landed: (count: string) => `${count} kenangan telah tiba` },
}

function LiveBrand({ config }: { config: PublicGalleryConfig | null }) {
  const { locale } = useLocale()
  return <div className="live-brand">
    <WeddingMonogram compact />
    <div><h1>Aleem <em>&amp;</em> Nurulain</h1><p className="live-date">{galleryDateLabel(config?.mode ?? null, locale)}</p></div>
  </div>
}

function LiveQr() {
  const { locale } = useLocale()
  const w = wallCopy[locale]
  return <aside className="live-qr" aria-label={copy[locale].qr.aria}>
    <div className="live-qr-code"><QRCodeSVG value={PUBLIC_GALLERY_URL} size={192} level="H" marginSize={4} bgColor="#fffdf8" fgColor="#052433" title={copy[locale].qr.scanTitle} /></div>
    <div className="live-qr-copy"><span className="live-qr-kicker">{w.boardingPass}</span><p>{w.share}</p><span>{w.noAccount}</span><span className="live-qr-route" aria-hidden="true">SIN <i /> <Plane size={14} /> <i /> &infin;</span></div>
  </aside>
}

/** The mount scales to fill its area using the photo's decoded proportions (metadata until it loads). */
const printName = (id: string) => `live-print-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`

function LivePhoto({ item, alt }: { item: GalleryMedia; alt: string }) {
  const metadata = item.width && item.height ? item.width / item.height : 4 / 3
  const [ratio, setRatio] = useState(metadata)
  return <img src={item.displayUrl} alt={alt} style={{ '--ar': ratio.toFixed(4) } as CSSProperties} onLoad={event => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setRatio(naturalWidth / naturalHeight) }} />
}

/** Newly approved photos go first; otherwise pick a random photo not shown recently. */
function chooseNext(items: GalleryMedia[], recent: string[], current?: string, arrivals: string[] = []) {
  const arrived = arrivals.map(id => items.find(item => item.id === id && item.id !== current)).find(Boolean)
  if (arrived) return arrived
  const available = items.filter((item) => item.id !== current && !recent.includes(item.id))
  const pool = available.length ? available : items.filter((item) => item.id !== current)
  return pool[Math.floor(Math.random() * Math.max(1, pool.length))] || items[0]
}

function preloadPhoto(item: GalleryMedia): Promise<boolean> {
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
    const image = new Image()
    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    image.src = item.displayUrl
    if (image.complete) finish(image.naturalWidth > 0)
  })
}

async function findPreloadedNext(items: GalleryMedia[], recent: string[], currentId: string, arrivals: string[]) {
  const attempted = new Set<string>()
  while (attempted.size < items.length - 1) {
    const remaining = items.filter((item) => !attempted.has(item.id))
    const candidate = chooseNext(remaining, recent, currentId, arrivals)
    if (!candidate || candidate.id === currentId) return null
    if (await preloadPhoto(candidate)) return candidate
    attempted.add(candidate.id)
  }
  return null
}

/** Hide the cursor and controls when nobody is touching the projector laptop. */
function useIdle() {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), IDLE_MS)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), IDLE_MS)
    }
    const events = ['pointermove', 'pointerdown', 'keydown'] as const
    events.forEach(name => window.addEventListener(name, wake))
    return () => { window.clearTimeout(timer); events.forEach(name => window.removeEventListener(name, wake)) }
  }, [])
  return idle
}

/** Best effort: keep the projector awake while the wall is open. */
function useWakeLock() {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    if (!wakeLock) return
    let sentinel: { release: () => Promise<void> } | null = null
    let active = true
    const request = () => {
      if (document.visibilityState !== 'visible') return
      void wakeLock.request('screen').then(lock => { if (active) sentinel = lock; else void lock.release().catch(() => undefined) }).catch(() => undefined)
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => { active = false; document.removeEventListener('visibilitychange', request); void sentinel?.release().catch(() => undefined) }
  }, [])
}

export default function LivePage() {
  // Route-aware navigation in the app; standalone rendering remains useful for
  // embeds and tests, including browser back/forward query changes.
  const routed = useInRouterContext()
  return routed ? <RoutedLivePage /> : <StandaloneLivePage />
}

function RoutedLivePage() {
  const { search } = useLocation()
  return <LivePageContent qrSide={qrSideFromSearch(search)} />
}

function StandaloneLivePage() {
  const search = useSyncExternalStore(subscribeToSearch, currentSearch, () => '')
  return <LivePageContent qrSide={qrSideFromSearch(search)} />
}

function LivePageContent({ qrSide }: { qrSide: QrSide }) {
  const { config, status, refresh } = useGalleryVisibility()
  const { locale } = useLocale()
  if (!config) return <main className="live-wall live-wall--waiting"><header className="live-header"><LiveBrand config={null} /><div className="live-controls"><LanguageToggle /></div></header><section className="live-empty" role={status === 'error' ? 'alert' : 'status'}><Plane aria-hidden="true" /><h2>{wallCopy[locale].wedding}</h2><p>{status === 'error' ? (locale === 'en' ? 'The gallery is temporarily unavailable.' : 'Galeri tidak tersedia buat sementara waktu.') : copy[locale].preparing}</p>{status === 'error' ? <button type="button" onClick={() => void refresh().catch(() => undefined)}><RefreshCw size={18} aria-hidden="true" />{copy[locale].tryAgain}</button> : null}</section></main>
  return <ConfiguredLivePage key={`${config.mode}|${config.revision}`} config={config} qrSide={qrSide} />
}

function ConfiguredLivePage({ config, qrSide }: { config: PublicGalleryConfig; qrSide: QrSide }) {
  const { locale } = useLocale()
  const t = copy[locale].live
  const w = wallCopy[locale]
  const [items, setItems] = useState<GalleryMedia[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [source, setSource] = useState<Source>(config.mode === 'both' ? 'all' : config.mode)
  const [current, setCurrent] = useState<GalleryMedia | null>(null)
  const [landedId, setLandedId] = useState<string | null>(null)
  const [pile, setPile] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const [paused, setPaused] = useState(reducedMotion)
  const [controlError, setControlError] = useState(false)
  const idle = useIdle()
  useWakeLock()
  const recent = useRef<string[]>([])
  const known = useRef<Set<string> | null>(null)
  const arrivals = useRef<string[]>([])
  const sourceRef = useRef<Source>(source)
  const refreshSequence = useRef(0)
  useEffect(() => () => { refreshSequence.current += 1 }, [])

  const refresh = useCallback(async () => {
    const requestedSource = source
    const sequence = ++refreshSequence.current
    try {
      const page = await getGallery({ event: requestedSource === 'all' ? undefined : requestedSource, limit: 50 })
      if (sequence !== refreshSequence.current || sourceRef.current !== requestedSource) return
      // The wall shows photographs only; any legacy video stays in the gallery viewer.
      const visible = page.items.filter(item => item.mediaType === 'photo' && (config.mode === 'both' || item.event.slug === config.mode) && (requestedSource === 'all' || item.event.slug === requestedSource))
      const visibleIds = new Set(visible.map(item => item.id))
      const fresh = known.current ? visible.filter(item => !known.current!.has(item.id)).map(item => item.id) : []
      arrivals.current = [...arrivals.current.filter(id => visibleIds.has(id)), ...fresh]
      known.current = visibleIds
      setItems(visible)
      setHasMore(Boolean(page.nextCursor))
      setCurrent((previous) => visible.find((item) => item.id === previous?.id) || chooseNext(visible, recent.current) || null)
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
    known.current = null
    arrivals.current = []
    setLandedId(null)
    setPile([])
    setSource(nextSource)
    setItems([])
    setCurrent(null)
  }, [config.mode])

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 20_000)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [refresh])

  useEffect(() => {
    let active = true
    const sync = async () => {
      try { const live = await getLiveConfig(); if (active) selectSource(live.source) }
      catch { if (active) { refreshSequence.current += 1; setItems([]); setCurrent(null); setError(t.reconnecting) } }
    }
    const first = window.setTimeout(() => void sync(), 0)
    const timer = window.setInterval(() => void sync(), 30_000)
    return () => { active = false; window.clearTimeout(first); window.clearInterval(timer) }
  }, [selectSource, t.reconnecting])

  useEffect(() => {
    if (paused || items.length < 2 || !current) return
    let cancelled = false
    const sequence = refreshSequence.current
    const nextReady = findPreloadedNext(items, recent.current, current.id, arrivals.current)
    const timer = window.setTimeout(() => {
      void nextReady.then((next) => {
        if (cancelled || !next || sequence !== refreshSequence.current) return
        const historySize = Math.min(8, Math.max(1, items.length - 1))
        recent.current = [...recent.current, current.id].slice(-historySize)
        const arrived = arrivals.current.includes(next.id)
        arrivals.current = arrivals.current.filter(id => id !== next.id)
        const advance = () => {
          setPile(previous => [current.id, ...previous.filter(id => id !== next.id && id !== current.id)].slice(0, 2))
          setCurrent(next)
          setLandedId(arrived ? next.id : null)
        }
        const transition = (document as Document & { startViewTransition?: (update: () => void) => unknown }).startViewTransition
        if (transition && !reducedMotion()) transition.call(document, () => flushSync(advance))
        else advance()
      })
    }, SLIDE_MS)
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

  const count = items.length ? `${items.length}${hasMore ? '+' : ''}` : ''
  const longMessage = (current?.guestMessage?.length ?? 0) > 120
  // Revoked or hidden photos leave the pile on the next refresh.
  const pilePrints = pile.map(id => items.find(item => item.id === id && item.id !== current?.id)).filter((item): item is GalleryMedia => Boolean(item))
  const memoryNumber = current ? [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).findIndex(item => item.id === current.id) + 1 : 0

  return (
    <main className={`live-wall${idle && !controlError ? ' live-wall--idle' : ''}`}>
      <svg className="live-route" viewBox="0 0 1600 900" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M-20 760C220 640 360 820 560 700S760 330 1000 380 1300 640 1460 420 1560 160 1640 120" /></svg>
      <header className="live-header">
        <LiveBrand config={config} />
        <div className="live-controls" role="group" aria-label={w.controls}>
          {config.mode === 'both' ? <div className="live-sources" role="group" aria-label={t.source}>
            {([['all', t.all], ['solemnisation', t.dayOne], ['reception', t.dayTwo]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={source === value} onClick={() => selectSource(value)}>{label}</button>)}
          </div> : null}
          <button type="button" className="live-icon-button" onClick={() => setPaused(value => !value)} aria-label={paused ? w.resume : w.pause} title={paused ? w.resume : w.pause}>{paused ? <Play size={20} aria-hidden="true" /> : <Pause size={20} aria-hidden="true" />}</button>
          <LanguageToggle />
          <button type="button" className="live-icon-button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? t.exitFullscreen : t.enterFullscreen} title={fullscreen ? t.exitFullscreen : t.enterFullscreen}>{fullscreen ? <Minimize size={20} aria-hidden="true" /> : <Expand size={20} aria-hidden="true" />}</button>
        </div>
        {controlError ? <p className="live-control-error" role="alert">{w.fullscreenError}</p> : null}
      </header>

      <div className={`live-stage live-stage--qr-${qrSide}`} data-qr-side={qrSide}>
        {qrSide === 'left' ? <LiveQr /> : null}
        {current ? (
          <section className="live-memory" key={current.id} aria-label={w.wall}>
            <div className="live-desk">
              <div className="live-pile" aria-hidden="true">{pilePrints.map((item, index) => <span key={item.id} className={`live-pile-print live-pile-print--${index}`} style={{ viewTransitionName: printName(item.id) } as CSSProperties}><img src={item.thumbnailUrl || item.displayUrl} alt="" decoding="async" /></span>)}</div>
              <figure className="live-media" style={{ viewTransitionName: printName(current.id) } as CSSProperties}>
                <span className="live-tape" aria-hidden="true" />
                <LivePhoto item={current} alt={current.guestMessage || `${t.memoryFrom} ${eventDateLabel(current.event.slug, locale)}`} />
                <figcaption className="live-print-chin"><span>A <i>&amp;</i> N</span><span className="live-print-number">{w.print} N&ordm; {String(memoryNumber).padStart(3, '0')}</span></figcaption>
                {landedId === current.id ? <span className="live-landed"><Plane size={18} aria-hidden="true" />{w.justLanded}</span> : null}
              </figure>
            </div>
            <div className={`live-caption${longMessage ? ' live-caption--long' : ''}`} role="region" aria-label={locale === 'en' ? 'Memory caption' : 'Kapsyen kenangan'} tabIndex={0}>
              <span className="live-postmark" aria-hidden="true"><span>SINGAPORE</span><Plane size={20} strokeWidth={1.4} /><span>{eventDateLabel(current.event.slug, locale).toUpperCase()}</span></span>
              <p className="live-caption-flight">{flightCode(current.event.slug)}<i aria-hidden="true" />{eventDateLabel(current.event.slug, locale)}</p>
              {current.guestMessage ? <blockquote>&ldquo;{current.guestMessage}&rdquo;</blockquote> : <blockquote>{t.quoteOne}<br /><em>{t.quoteTwo}</em></blockquote>}
              {current.guestName ? <p className="live-credit"><span>{t.sharedBy}</span><strong>{current.guestName}</strong></p> : <p className="live-credit"><span>{w.wedding}</span><strong>Aleem &amp; Nurulain</strong></p>}
            </div>
          </section>
        ) : (
          <section className="live-empty" role={error ? 'alert' : 'status'}><ImageOff aria-hidden="true" /><h2>{t.boardingOne}<br /><em>{t.boardingTwo}</em></h2><p>{error || t.approvedAppear}</p>{error ? <button type="button" onClick={() => void refresh()}><RefreshCw size={18} aria-hidden="true" />{t.reconnect}</button> : null}</section>
        )}
        {qrSide === 'right' ? <LiveQr /> : null}
      </div>

      <footer className="live-footer">
        <span className="live-count">{count ? w.landed(count) : null}</span>
        <div className="live-footer-meta">
          <a href={PUBLIC_GALLERY_URL}>gallery.aleemxnurul.love<ArrowUpRight size={16} aria-hidden="true" /></a>
          <span className="live-status" role="status"><i aria-hidden="true" />{error || (paused ? w.paused : t.approved)}</span>
        </div>
      </footer>
    </main>
  )
}
