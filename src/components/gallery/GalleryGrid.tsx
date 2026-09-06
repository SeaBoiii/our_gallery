import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import type { GalleryMedia } from '../../../shared/contracts'
import { GALLERY_PAGE_SIZE } from '../../config'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'
import { getGallery, getGalleryMedia } from '../../services/api'
import { GalleryFilters, type GalleryFilterState } from './GalleryFilters'
import { mergeGalleryPage } from './galleryMerge'
import { MemoryCard } from './MemoryCard'
import { MemoryLightbox } from './MemoryLightbox'

export function GalleryGrid() {
  const { locale } = useLocale()
  const t = copy[locale].gallery
  const [filters, setFilters] = useState<GalleryFilterState>({ event: 'all', type: 'all' })
  const [items, setItems] = useState<GalleryMedia[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const requestSequence = useRef(0)
  const requestedMemory = useRef<string | null>(null)

  const query = useMemo(() => ({
    event: filters.event === 'all' ? undefined : filters.event,
    type: filters.type === 'all' ? undefined : filters.type,
  }), [filters])

  const load = useCallback(async (nextCursor?: string) => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setError(null)
    try {
      const page = await getGallery({ ...query, cursor: nextCursor, limit: GALLERY_PAGE_SIZE })
      if (sequence !== requestSequence.current) return
      setItems((current) => mergeGalleryPage(current, page.items, Boolean(nextCursor), requestedMemory.current))
      setCursor(page.nextCursor)
    } catch {
      if (sequence === requestSequence.current) setError(t.loadError)
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [query, t.loadError])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(),0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !cursor || loading) return
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void load(cursor) }, { rootMargin: '500px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, loading, load])

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('memory')
    if (!requested || selectedId !== null || requestedMemory.current === requested) return
    requestedMemory.current = requested
    void getGalleryMedia(requested).then((fresh) => {
      setItems((current) => {
        const existing = current.some((item) => item.id === fresh.id)
        return existing ? current.map((item) => item.id === fresh.id ? fresh : item) : [fresh, ...current]
      })
      setSelectedId(fresh.id)
    }).catch(() => {
      requestedMemory.current = null
      setError(t.loadError)
    })
  }, [selectedId, t.loadError])

  const open = async (index: number) => {
    const selected = items[index]
    try {
      const fresh = await getGalleryMedia(selected.id)
      setItems((current) => current.map((item) => item.id === fresh.id ? fresh : item))
    } catch {
      // The existing URL may still be valid; the lightbox can refresh on error.
    }
    setSelectedId(selected.id)
    window.history.replaceState({}, '', `${window.location.pathname}?memory=${encodeURIComponent(selected.id)}`)
  }
  const close = () => {
    setSelectedId(null)
    requestedMemory.current = null
    window.history.replaceState({}, '', window.location.pathname)
  }

  return (
    <div className="gallery-surface">
      <GalleryFilters value={filters} onChange={setFilters} />
      {error ? (
        <div className="gallery-state" role="alert"><p>{error}</p><button className="button button-secondary" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" size={16} />{t.tryAgain}</button></div>
      ) : null}
      {!error && !loading && items.length === 0 ? <div className="gallery-state"><p>{t.empty}</p></div> : null}
      <div className="memory-grid" aria-busy={loading && items.length === 0}>
        {items.map((item, index) => <MemoryCard key={item.id} memory={item} onOpen={() => void open(index)} />)}
      </div>
      {loading ? <div className="gallery-loading" role="status"><LoaderCircle aria-hidden="true" className="spin" />{t.loading}</div> : null}
      <div ref={loadMoreRef} className="load-more-sentinel" aria-hidden="true" />
      {selectedId && items.some((item) => item.id === selectedId) ? <MemoryLightbox items={items} index={items.findIndex((item) => item.id === selectedId)} onClose={close} onIndexChange={(index) => { setSelectedId(items[index].id); window.history.replaceState({}, '', `${window.location.pathname}?memory=${encodeURIComponent(items[index].id)}`) }} onRefresh={async (id) => { const fresh = await getGalleryMedia(id); setItems((current) => current.map((item) => item.id === id ? fresh : item)) }} /> : null}
    </div>
  )
}
