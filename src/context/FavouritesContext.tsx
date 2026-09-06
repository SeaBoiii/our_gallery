import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FavouritesContext } from './favourites-context'

export const FAVOURITES_STORAGE_KEY = 'an-gallery-favourites-v1'
export const MAX_FAVOURITES = 100

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128))].slice(0, MAX_FAVOURITES)
}

function readFavourites(): string[] {
  try { return cleanIds(JSON.parse(window.localStorage.getItem(FAVOURITES_STORAGE_KEY) || '[]')) }
  catch { return [] }
}

export function FavouritesProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>(readFavourites)

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== FAVOURITES_STORAGE_KEY) return
      try { setIds(cleanIds(JSON.parse(event.newValue || '[]'))) } catch { setIds([]) }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const persist = useCallback((update: (current: string[]) => string[]) => {
    setIds((current) => {
      const next = cleanIds(update(current))
      try { window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(next)) } catch { /* Storage may be disabled. */ }
      return next
    })
  }, [])

  const toggleFavourite = useCallback((id: string) => persist((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [id, ...current]), [persist])
  const removeFavourites = useCallback((removed: string[]) => {
    const removal = new Set(removed)
    persist((current) => current.filter((id) => !removal.has(id)))
  }, [persist])
  const clearFavourites = useCallback(() => persist(() => []), [persist])
  const favouriteSet = useMemo(() => new Set(ids), [ids])
  const value = useMemo(() => ({ ids, isFavourite: (id: string) => favouriteSet.has(id), toggleFavourite, removeFavourites, clearFavourites }), [ids, favouriteSet, toggleFavourite, removeFavourites, clearFavourites])

  return <FavouritesContext.Provider value={value}>{children}</FavouritesContext.Provider>
}
