import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, ImagePlus, LoaderCircle, RefreshCw } from 'lucide-react'
import type { GalleryMedia } from '../../../shared/contracts'
import { GALLERY_PAGE_SIZE } from '../../config'
import { useLocale } from '../../context/useLocale'
import { useDownloadAvailability } from '../../hooks/useDownloadAvailability'
import { copy } from '../../i18n/copy'
import { getGallery, getGalleryMedia } from '../../services/api'
import { WeddingMonogram } from '../WeddingMonogram'
import { GalleryFilters, type GalleryFilterState } from './GalleryFilters'
import { mergeGalleryPage } from './galleryMerge'
import { MemoryCard } from './MemoryCard'
import { MemoryLightbox } from './MemoryLightbox'

type ResetLoadKind = 'initial' | 'filter' | null

const LIGHTBOX_HISTORY_KEY = 'galleryLightbox'
const SKELETON_COUNT = 8

function memoryUrl(memoryId: string | null) {
  const url = new URL(window.location.href)
  if (memoryId) url.searchParams.set('memory', memoryId)
  else url.searchParams.delete('memory')
  return `${url.pathname}${url.search}${url.hash}`
}

function historyState(lightbox: boolean) {
  const current = window.history.state
  return {
    ...(current && typeof current === 'object' ? current : {}),
    [LIGHTBOX_HISTORY_KEY]: lightbox,
  }
}

function matchesFilters(memory: GalleryMedia, filters: GalleryFilterState) {
  return (filters.event === 'all' || memory.event.slug === filters.event)
    && (filters.type === 'all' || memory.mediaType === filters.type)
}

export function GalleryGrid({ onAddMemory }: { onAddMemory: () => void }) {
  const { locale } = useLocale()
  const t = copy[locale].gallery
  const [filters, setFilters] = useState<GalleryFilterState>({ event: 'all', type: 'all' })
  const [items, setItems] = useState<GalleryMedia[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [resetLoadKind, setResetLoadKind] = useState<ResetLoadKind>('initial')
  const [paginationLoading, setPaginationLoading] = useState(false)
  const [initialError, setInitialError] = useState(false)
  const [paginationError, setPaginationError] = useState(false)
  const [memoryError, setMemoryError] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const requestSequence = useRef(0)
  const requestedMemory = useRef<string | null>(null)
  const mediaRequests = useRef(new Set<string>())
  const itemsRef = useRef(items)
  const filtersRef = useRef(filters)
  const paginationRequest = useRef<number | null>(null)
  const firstQuery = useRef(true)
  const { downloadsAvailable, availableAt, markDownloadsLocked } = useDownloadAvailability()

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const query = useMemo(() => ({
    event: filters.event === 'all' ? undefined : filters.event,
    type: filters.type === 'all' ? undefined : filters.type,
  }), [filters])

  const refreshMedia = useCallback(async (mediaId: string) => {
    if (mediaRequests.current.has(mediaId)) return
    mediaRequests.current.add(mediaId)
    try {
      const fresh = await getGalleryMedia(mediaId)
      setItems((current) => {
        const existing = current.some((item) => item.id === fresh.id)
        const belongsInCurrentView = matchesFilters(fresh, filtersRef.current)
        if (existing) {
          return belongsInCurrentView
            ? current.map((item) => item.id === fresh.id ? fresh : item)
            : current.filter((item) => item.id !== fresh.id)
        }
        const isActiveDeepLink = new URLSearchParams(window.location.search).get('memory') === fresh.id
        return belongsInCurrentView && isActiveDeepLink ? [fresh, ...current] : current
      })
      setMemoryError(false)
    } catch {
      if (new URLSearchParams(window.location.search).get('memory') === mediaId && !itemsRef.current.some((item) => item.id === mediaId)) {
        setMemoryError(true)
      }
      throw new Error('Unable to refresh gallery media')
    } finally {
      mediaRequests.current.delete(mediaId)
    }
  }, [])

  const syncSelectionFromUrl = useCallback(() => {
    const requested = new URLSearchParams(window.location.search).get('memory')
    requestedMemory.current = requested
    setSelectedId(requested)
    setMemoryError(false)
    if (requested) void refreshMedia(requested).catch(() => undefined)
  }, [refreshMedia])

  useEffect(() => {
    const timer = window.setTimeout(syncSelectionFromUrl, 0)
    window.addEventListener('popstate', syncSelectionFromUrl)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('popstate', syncSelectionFromUrl)
    }
  }, [syncSelectionFromUrl])

  const loadFirstPage = useCallback(async () => {
    const sequence = ++requestSequence.current
    setInitialError(false)
    setPaginationError(false)
    setCursor(null)
    try {
      const page = await getGallery({ ...query, limit: GALLERY_PAGE_SIZE })
      if (sequence !== requestSequence.current) return
      setItems((current) => mergeGalleryPage(current, page.items, false, requestedMemory.current))
      setCursor(page.nextCursor)
      setHasLoaded(true)
    } catch {
      if (sequence === requestSequence.current) setInitialError(true)
    } finally {
      if (sequence === requestSequence.current) setResetLoadKind(null)
    }
  }, [query])

  useEffect(() => {
    const kind: Exclude<ResetLoadKind, null> = firstQuery.current ? 'initial' : 'filter'
    firstQuery.current = false
    setResetLoadKind(kind)
    const timer = window.setTimeout(() => void loadFirstPage(), 0)
    return () => window.clearTimeout(timer)
  }, [loadFirstPage])

  const loadMore = useCallback(async (nextCursor: string) => {
    if (paginationRequest.current !== null) return
    const sequence = ++requestSequence.current
    paginationRequest.current = sequence
    setPaginationLoading(true)
    setPaginationError(false)
    try {
      const page = await getGallery({ ...query, cursor: nextCursor, limit: GALLERY_PAGE_SIZE })
      if (sequence !== requestSequence.current) return
      setItems((current) => mergeGalleryPage(current, page.items, true, requestedMemory.current))
      setCursor(page.nextCursor)
    } catch {
      if (sequence === requestSequence.current) setPaginationError(true)
    } finally {
      if (paginationRequest.current === sequence) paginationRequest.current = null
      if (sequence === requestSequence.current) setPaginationLoading(false)
    }
  }, [query])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !cursor || resetLoadKind || paginationLoading || paginationError) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadMore(cursor)
    }, { rootMargin: '500px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, loadMore, paginationError, paginationLoading, resetLoadKind])

  const changeFilters = (next: GalleryFilterState) => {
    if (next.event === filters.event && next.type === filters.type) return
    filtersRef.current = next
    requestSequence.current += 1
    setItems([])
    setCursor(null)
    setInitialError(false)
    setPaginationError(false)
    setPaginationLoading(false)
    paginationRequest.current = null
    setResetLoadKind('filter')
    setFilters(next)
  }

  const open = (memory: GalleryMedia) => {
    setSelectedId(memory.id)
    requestedMemory.current = memory.id
    window.history.pushState(historyState(true), '', memoryUrl(memory.id))
    void refreshMedia(memory.id).catch(() => undefined)
  }

  const close = () => {
    if (window.history.state?.[LIGHTBOX_HISTORY_KEY]) {
      window.history.back()
      return
    }
    requestedMemory.current = null
    setSelectedId(null)
    window.history.replaceState(historyState(false), '', memoryUrl(null))
  }

  const changeLightboxIndex = (index: number) => {
    const next = items[index]
    if (!next) return
    requestedMemory.current = next.id
    setSelectedId(next.id)
    window.history.replaceState(historyState(Boolean(window.history.state?.[LIGHTBOX_HISTORY_KEY])), '', memoryUrl(next.id))
    void refreshMedia(next.id).catch(() => undefined)
  }

  const filtered = filters.event !== 'all' || filters.type !== 'all'
  const selectedIndex = selectedId ? items.findIndex((item) => item.id === selectedId) : -1
  const releaseDate = availableAt
    ? new Intl.DateTimeFormat(locale === 'ms' ? 'ms-MY' : 'en-SG', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore',
    }).format(new Date(availableAt))
    : null

  return (
    <div className="gallery-surface">
      {!downloadsAvailable && releaseDate ? (
        <p className="download-release-note"><Clock3 aria-hidden="true" size={15} />{t.downloadsOpen(releaseDate)}</p>
      ) : null}
      <GalleryFilters value={filters} onChange={changeFilters} />
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {hasLoaded && !resetLoadKind && !initialError ? t.resultsShown(items.length) : ''}
      </p>

      {memoryError ? <div className="gallery-inline-alert" role="alert">{t.loadError}</div> : null}

      {initialError ? (
        <div className="gallery-state" role="alert">
          <p>{t.loadError}</p>
          <button className="button button-secondary" type="button" onClick={() => { setResetLoadKind(hasLoaded ? 'filter' : 'initial'); void loadFirstPage() }}>
            <RefreshCw aria-hidden="true" size={16} />{t.tryAgain}
          </button>
        </div>
      ) : null}

      {!initialError && resetLoadKind ? (
        <>
          <div className="memory-grid memory-grid--skeleton" aria-hidden="true">
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <div key={index} className={`memory-skeleton memory-skeleton--${index % 3}`}>
                <span /><span /><span />
              </div>
            ))}
          </div>
          <p className="visually-hidden" role="status">{t.loading}</p>
        </>
      ) : null}

      {!initialError && !resetLoadKind && items.length === 0 ? (
        <div className="gallery-state gallery-state--empty" role="status">
          <WeddingMonogram compact />
          <h3>{filtered ? t.noMatchesTitle : t.emptyTitle}</h3>
          <p>{filtered ? t.noMatchesBody : t.emptyBody}</p>
          {filtered ? (
            <button className="button button-secondary" type="button" onClick={() => changeFilters({ event: 'all', type: 'all' })}>
              <RefreshCw aria-hidden="true" size={16} />{t.clearFilters}
            </button>
          ) : (
            <button className="button button-primary" type="button" onClick={onAddMemory}>
              <ImagePlus aria-hidden="true" size={17} />{t.addMemory}
            </button>
          )}
        </div>
      ) : null}

      {!resetLoadKind && items.length > 0 ? (
        <div className="memory-grid" aria-busy={paginationLoading}>
          {items.map((item) => <MemoryCard key={item.id} memory={item} onOpen={() => open(item)} />)}
        </div>
      ) : null}

      {paginationLoading ? <div className="gallery-loading" role="status"><LoaderCircle aria-hidden="true" className="spin" />{t.loading}</div> : null}
      {paginationError && cursor ? (
        <div className="gallery-pagination-error" role="alert">
          <span>{t.loadMoreError}</span>
          <button type="button" onClick={() => void loadMore(cursor)}><RefreshCw aria-hidden="true" size={15} />{t.tryAgain}</button>
        </div>
      ) : null}
      <div ref={loadMoreRef} className="load-more-sentinel" aria-hidden="true" />

      {!resetLoadKind && !paginationLoading && !paginationError && items.length > 0 && !cursor ? (
        <div className="gallery-end" aria-label={t.endOfGallery}>
          <span aria-hidden="true" /><WeddingMonogram compact /><span aria-hidden="true" />
          <p>{t.endOfGallery}</p>
        </div>
      ) : null}

      {selectedIndex >= 0 ? (
        <MemoryLightbox
          items={items}
          index={selectedIndex}
          downloadsAvailable={downloadsAvailable}
          onDownloadsLocked={markDownloadsLocked}
          onClose={close}
          onIndexChange={changeLightboxIndex}
          onRefresh={refreshMedia}
        />
      ) : null}
    </div>
  )
}
