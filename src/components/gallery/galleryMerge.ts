import type { GalleryMedia } from '../../../shared/contracts'

export function mergeGalleryPage(current: GalleryMedia[], incoming: GalleryMedia[], append: boolean, pinnedId: string | null) {
  if (append) return [...current, ...incoming.filter((item) => !current.some((existing) => existing.id === item.id))]
  const pinned = pinnedId ? current.find((item) => item.id === pinnedId) : undefined
  return pinned && !incoming.some((item) => item.id === pinned.id) ? [pinned, ...incoming] : incoming
}
