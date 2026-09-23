import { useContext } from 'react'
import { GalleryVisibilityContext } from './gallery-visibility-context'

export function useGalleryVisibility() {
  const value = useContext(GalleryVisibilityContext)
  if (!value) throw new Error('useGalleryVisibility must be used within GalleryVisibilityProvider')
  return value
}
