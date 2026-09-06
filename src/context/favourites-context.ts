import { createContext } from 'react'

export type FavouritesContextValue = {
  ids: string[]
  isFavourite: (id: string) => boolean
  toggleFavourite: (id: string) => void
  removeFavourites: (ids: string[]) => void
  clearFavourites: () => void
}

export const FavouritesContext = createContext<FavouritesContextValue | null>(null)
