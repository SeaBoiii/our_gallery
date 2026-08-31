import { describe, expect, it } from 'vitest'
import { mockGallery } from '../../data/mock'
import { mergeGalleryPage } from './galleryMerge'

describe('gallery page merging', () => {
  it('keeps a deep-linked memory pinned when the initial page resolves later', () => {
    const pinned = mockGallery[0]
    const page = mockGallery.slice(1, 4)
    expect(mergeGalleryPage([pinned], page, false, pinned.id).map((item) => item.id)).toEqual([
      pinned.id,
      ...page.map((item) => item.id),
    ])
  })

  it('does not duplicate memories while appending another cursor page', () => {
    expect(mergeGalleryPage(mockGallery.slice(0, 2), mockGallery.slice(1, 3), true, null).map((item) => item.id)).toEqual([
      mockGallery[0].id,
      mockGallery[1].id,
      mockGallery[2].id,
    ])
  })
})
