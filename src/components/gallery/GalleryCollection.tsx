import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { GalleryMedia } from '../../../shared/contracts'
import { useFavourites } from '../../context/useFavourites'
import { getGalleryMedia } from '../../services/api'
import { MemoryCard } from './MemoryCard'
import { MemoryLightbox } from './MemoryLightbox'

type Props = {
  items: GalleryMedia[]
  onItemUpdate?: (item: GalleryMedia) => void
  updateMemoryParam?: boolean
  emptyMessage?: string
  busy?: boolean
}

export function GalleryCollection({ items, onItemUpdate, updateMemoryParam = true, emptyMessage, busy = false }: Props) {
  const { isFavourite, toggleFavourite } = useFavourites()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const requestedMemory = useRef<string | null>(null)

  const setMemoryParam = useCallback((id: string | null) => {
    if (!updateMemoryParam) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (id) next.set('memory', id)
      else next.delete('memory')
      return next
    }, { replace: true })
  }, [setSearchParams, updateMemoryParam])

  useEffect(() => {
    if (!updateMemoryParam) return
    const requested = searchParams.get('memory')
    let cancelled = false
    const select = (id: string | null) => {
      if (!cancelled) setSelectedId(id)
    }
    if (!requested) {
      requestedMemory.current = null
      const timer = window.setTimeout(() => select(null), 0)
      return () => { cancelled = true; window.clearTimeout(timer) }
    }
    if (requestedMemory.current === requested) return
    requestedMemory.current = requested
    const existing = items.find((item) => item.id === requested)
    if (existing) {
      const timer = window.setTimeout(() => select(existing.id), 0)
      return () => { cancelled = true; window.clearTimeout(timer) }
    }
    void getGalleryMedia(requested).then((fresh) => {
      if (cancelled) return
      onItemUpdate?.(fresh)
      setSelectedId(fresh.id)
    }).catch(() => {
      if (cancelled) return
      requestedMemory.current = null
      setMemoryParam(null)
    })
    return () => { cancelled = true }
  }, [items, onItemUpdate, searchParams, setMemoryParam, updateMemoryParam])

  const open = async (item: GalleryMedia) => {
    setSelectedId(item.id)
    setMemoryParam(item.id)
    try {
      const fresh = await getGalleryMedia(item.id)
      onItemUpdate?.(fresh)
    } catch { /* The existing signed URL may still be usable. */ }
  }

  const selectedIndex = selectedId ? items.findIndex((item) => item.id === selectedId) : -1
  return (
    <>
      {!busy && items.length === 0 && emptyMessage ? <div className="gallery-state"><p>{emptyMessage}</p></div> : null}
      <div className="memory-grid" aria-busy={busy}>
        {items.map((item) => <MemoryCard key={item.id} memory={item} onOpen={() => void open(item)} favourite={isFavourite(item.id)} onToggleFavourite={() => toggleFavourite(item.id)} />)}
      </div>
      {selectedIndex >= 0 ? <MemoryLightbox
        items={items}
        index={selectedIndex}
        onClose={() => { setSelectedId(null); requestedMemory.current = null; setMemoryParam(null) }}
        onIndexChange={(index) => { const id = items[index]?.id; if (id) { setSelectedId(id); setMemoryParam(id) } }}
        onRefresh={async (id) => {
          const fresh = await getGalleryMedia(id)
          onItemUpdate?.(fresh)
        }}
        favourite={isFavourite(items[selectedIndex].id)}
        onToggleFavourite={() => toggleFavourite(items[selectedIndex].id)}
        canonicalPath="/gallery"
      /> : null}
    </>
  )
}
