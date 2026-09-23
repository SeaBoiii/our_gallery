import { createContext } from 'react'
import type { PublicGalleryConfig } from '../../shared/contracts'

export type GalleryVisibilityContextValue = {
  config: PublicGalleryConfig | null
  status: 'loading' | 'ready' | 'error'
  refresh: () => Promise<PublicGalleryConfig>
}

export const GalleryVisibilityContext = createContext<GalleryVisibilityContextValue | null>(null)
