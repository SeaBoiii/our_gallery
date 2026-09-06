import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import type { GalleryMedia } from '../../../shared/contracts'
import { GALLERY_PAGE_SIZE } from '../../config'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'
import { getGallery } from '../../services/api'
import { GalleryFilters, type GalleryFilterState } from './GalleryFilters'
import { mergeGalleryPage } from './galleryMerge'
import { GalleryCollection } from './GalleryCollection'

export function GalleryGrid() {
  const { locale } = useLocale()
  const t = copy[locale].gallery
  const [filters, setFilters] = useState<GalleryFilterState>({ event: 'all', type: 'all' })
  const [items, setItems] = useState<GalleryMedia[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const requestSequence = useRef(0)

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
      setItems((current) => mergeGalleryPage(current, page.items, Boolean(nextCursor), new URLSearchParams(window.location.search).get('memory')))
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

  return (
    <div className="gallery-surface">
      <GalleryFilters value={filters} onChange={setFilters} />
      {error ? (
        <div className="gallery-state" role="alert"><p>{error}</p><button className="button button-secondary" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" size={16} />{t.tryAgain}</button></div>
      ) : null}
      <GalleryCollection items={items} busy={loading && items.length === 0} emptyMessage={t.empty} onItemUpdate={(fresh) => setItems((current) => current.some((item) => item.id === fresh.id) ? current.map((item) => item.id === fresh.id ? fresh : item) : [fresh, ...current])} />
      {loading ? <div className="gallery-loading" role="status"><LoaderCircle aria-hidden="true" className="spin" />{t.loading}</div> : null}
      <div ref={loadMoreRef} className="load-more-sentinel" aria-hidden="true" />
    </div>
  )
}
