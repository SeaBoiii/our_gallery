import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Heart, LoaderCircle, Search, Sparkles } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { EventSlug, GalleryCategory, GalleryMedia, MediaType } from '../../shared/contracts'
import { CloudBackdrop } from '../components/CloudBackdrop'
import { FlightHeader } from '../components/FlightHeader'
import { GalleryCollection } from '../components/gallery/GalleryCollection'
import { useFavourites } from '../context/useFavourites'
import { useLocale } from '../context/useLocale'
import { GalleryApiError, getCapabilities, getDiscoveryCategories, getGallery, lookupFavouriteMemories, searchMemories } from '../services/api'

const text = {
  en: {
    eyebrow: 'Memory search', title: 'Where would you like to travel back to?', body: 'Browse our journey by moment, or describe the memory you have in mind.', placeholder: 'Search our memories…', search: 'Search memories', destinations: 'Destinations', all: 'All memories', favourites: 'My Favourite Memories', noFavourites: 'Tap the heart on a memory to keep it here on this device.', empty: 'No approved memories match this route yet.', unavailable: 'Natural-language search is resting right now. Category browsing is still available.', loading: 'Looking through our memories…', day1: 'Solemnisation', day2: "Groom's Reception", photos: 'Photos', videos: 'Videos', guest: 'Guest uploads', photographer: 'Photographer', filters: 'Memory filters', searchResults: 'Search results', clear: 'Clear search', failed: 'Memories could not be loaded. Please try again.',
  },
  ms: {
    eyebrow: 'Carian kenangan', title: 'Ke manakah anda ingin kembali?', body: 'Terokai perjalanan kami mengikut detik, atau huraikan kenangan yang dicari.', placeholder: 'Cari kenangan kami…', search: 'Cari kenangan', destinations: 'Destinasi', all: 'Semua kenangan', favourites: 'Kenangan Kegemaran Saya', noFavourites: 'Ketik hati pada kenangan untuk menyimpannya pada peranti ini.', empty: 'Belum ada kenangan diluluskan yang sepadan.', unavailable: 'Carian bahasa semula jadi sedang berehat. Carian kategori masih tersedia.', loading: 'Mencari dalam kenangan kami…', day1: 'Akad Nikah', day2: 'Resepsi Pengantin Lelaki', photos: 'Foto', videos: 'Video', guest: 'Muat naik tetamu', photographer: 'Jurugambar', filters: 'Penapis kenangan', searchResults: 'Hasil carian', clear: 'Kosongkan carian', failed: 'Kenangan tidak dapat dimuatkan. Sila cuba lagi.',
  },
} as const

type View = 'browse' | 'favourites'

export default function ExplorePage() {
  const { locale } = useLocale()
  const t = text[locale]
  const { ids: favouriteIds, removeFavourites } = useFavourites()
  const [params, setParams] = useSearchParams()
  const [categories, setCategories] = useState<GalleryCategory[]>([])
  const [items, setItems] = useState<GalleryMedia[]>([])
  const initialQuery = params.get('q') || ''
  const [draftState, setDraftState] = useState(() => ({ sourceQuery: initialQuery, value: initialQuery }))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [semanticAvailable, setSemanticAvailable] = useState(true)
  const requestId = useRef(0)
  const view: View = params.get('view') === 'favourites' ? 'favourites' : 'browse'
  const query = params.get('q') || ''
  const event = (params.get('event') || '') as EventSlug | ''
  const type = (params.get('type') || '') as MediaType | ''
  const source = (params.get('source') || '') as 'guest' | 'photographer' | ''
  const category = params.get('category') || ''
  const draft = draftState.sourceQuery === query ? draftState.value : query
  const setDraft = (value: string) => setDraftState({ sourceQuery: query, value })

  const update = useCallback((values: Record<string, string | null>) => setParams((current) => {
    const next = new URLSearchParams(current)
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    next.delete('memory')
    return next
  }), [setParams])

  useEffect(() => {
    void Promise.all([getDiscoveryCategories(), getCapabilities()]).then(([nextCategories, capabilities]) => {
      setCategories(nextCategories)
      setSemanticAvailable(capabilities.semanticSearchEnabled)
    }).catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    const sequence = ++requestId.current
    const startTimer = window.setTimeout(() => {
      if (sequence !== requestId.current) return
      setLoading(true)
      setError(null)
      setItems([])
    }, 0)
    const run = async () => {
      if (view === 'favourites') {
        if (!favouriteIds.length) return { items: [] as GalleryMedia[], missingIds: [] as string[] }
        return lookupFavouriteMemories(favouriteIds)
      }
      if (query.trim().length >= 2) {
        const result = await searchMemories({ query: query.trim(), event: event || undefined, type: type || undefined, source: source || undefined, category: category || undefined, limit: 50 })
        setSemanticAvailable(result.semanticAvailable)
        return result
      }
      return getGallery({ event: event || undefined, type: type || undefined, source: source || undefined, category: category || undefined, limit: 50 })
    }
    void run().then((result) => {
      if (sequence !== requestId.current) return
      if ('missingIds' in result && result.missingIds.length) removeFavourites(result.missingIds)
      setItems(result.items)
    }).catch((reason) => {
      if (sequence !== requestId.current) return
      if (reason instanceof GalleryApiError && reason.code === 'SEMANTIC_SEARCH_UNAVAILABLE') {
        setSemanticAvailable(false)
        update({ q: null })
      } else { setItems([]); setError(t.failed) }
    }).finally(() => { if (sequence === requestId.current) setLoading(false) })
    return () => window.clearTimeout(startTimer)
  }, [category, event, favouriteIds, query, removeFavourites, source, t.failed, type, update, view])

  const submit = (eventValue: FormEvent) => {
    eventValue.preventDefault()
    const value = draft.trim()
    if (value.length >= 2) update({ q: value, view: null })
  }

  return (
    <main className="phase2-page explore-page">
      <CloudBackdrop />
      <FlightHeader />
      <section className="phase2-hero">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1>{t.title}</h1>
        <p>{t.body}</p>
        <form className="memory-search" onSubmit={submit} role="search">
          <Search aria-hidden="true" />
          <label className="visually-hidden" htmlFor="memory-search-input">{t.placeholder}</label>
          <input id="memory-search-input" value={draft} onChange={(eventValue) => setDraft(eventValue.target.value)} placeholder={t.placeholder} minLength={2} />
          <button type="submit" disabled={draft.trim().length < 2 || !semanticAvailable}><Sparkles aria-hidden="true" />{t.search}</button>
        </form>
        {!semanticAvailable ? <p className="phase2-notice" role="status">{t.unavailable}</p> : null}
      </section>

      <section className="explore-surface" aria-labelledby="destinations-title">
        <div className="explore-title-row"><div><p className="eyebrow">AN-210827</p><h2 id="destinations-title">{query ? t.searchResults : t.destinations}</h2></div>{query ? <button className="text-action" type="button" onClick={() => { setDraft(''); update({ q: null }) }}>{t.clear}</button> : null}</div>
        <div className="destination-grid">
          <button className={!category && view === 'browse' ? 'is-active' : ''} type="button" aria-pressed={!category && view === 'browse'} onClick={() => update({ category: null, view: null, q: null })}><span>01</span><strong>{t.all}</strong></button>
          {categories.slice(0, 8).map((item, index) => <button className={category === item.slug && view === 'browse' ? 'is-active' : ''} key={item.id} type="button" aria-pressed={category === item.slug && view === 'browse'} onClick={() => update({ category: item.slug, view: null, q: null })}><span>{String(index + 2).padStart(2, '0')}</span><strong>{item.displayName}</strong></button>)}
          <button className={view === 'favourites' ? 'is-active' : ''} type="button" aria-pressed={view === 'favourites'} onClick={() => update({ view: 'favourites', category: null, q: null })}><Heart aria-hidden="true" /><strong>{t.favourites}</strong></button>
        </div>
        <div className="explore-filters" aria-label={t.filters}>
          <select aria-label="Event" value={event} onChange={(value) => update({ event: value.target.value || null })}><option value="">{t.all}</option><option value="solemnisation">{t.day1}</option><option value="reception">{t.day2}</option></select>
          <select aria-label="Media" value={type} onChange={(value) => update({ type: value.target.value || null })}><option value="">{t.all}</option><option value="photo">{t.photos}</option><option value="video">{t.videos}</option></select>
          <select aria-label="Source" value={source} onChange={(value) => update({ source: value.target.value || null })}><option value="">{t.all}</option><option value="guest">{t.guest}</option><option value="photographer">{t.photographer}</option></select>
        </div>
        {error ? <div className="gallery-state" role="alert"><p>{error}</p></div> : null}
        <GalleryCollection items={items} busy={loading} emptyMessage={view === 'favourites' ? t.noFavourites : t.empty} onItemUpdate={(fresh) => setItems((current) => current.map((item) => item.id === fresh.id ? fresh : item))} />
        {loading ? <div className="gallery-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" />{t.loading}</div> : null}
      </section>
    </main>
  )
}
