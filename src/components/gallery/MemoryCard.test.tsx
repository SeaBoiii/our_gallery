import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GalleryMedia } from '../../../shared/contracts'
import { LocaleProvider } from '../../context/LocaleContext'
import { mockGallery } from '../../data/mock'
import { copy } from '../../i18n/copy'
import { MemoryCard } from './MemoryCard'

const memory: GalleryMedia = {
  ...mockGallery[0],
  width: 1350,
  height: 1800,
  thumbnailUrl: 'https://media.test/thumbnail.webp',
  displayUrl: 'https://media.test/display.webp',
}

function card(item = memory, onOpen = vi.fn()) {
  return <LocaleProvider><MemoryCard memory={item} number={7} onOpen={onOpen} /></LocaleProvider>
}

describe('journal photographs', () => {
  it('offers the correct responsive derivative widths and preserves portrait dimensions', () => {
    render(card())
    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('srcset', 'https://media.test/thumbnail.webp 360w, https://media.test/display.webp 1350w')
    expect(image).toHaveAttribute('width', '1350')
    expect(image).toHaveAttribute('height', '1800')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(screen.getByText('07')).toBeInTheDocument()
    expect(screen.getByText(memory.guestMessage!)).toBeInTheDocument()
  })

  it('uses a display derivative if a thumbnail fails, and still opens the viewer if both fail', () => {
    const open = vi.fn()
    render(card(memory, open))
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByRole('img')).toHaveAttribute('src', memory.displayUrl)
    expect(screen.getByRole('img')).not.toHaveAttribute('srcset')
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText(copy.en.gallery.previewUnavailable)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open photo/i }))
    expect(open).toHaveBeenCalledOnce()
  })

  it('falls back to the thumbnail when the browser-selected display derivative fails', () => {
    render(card())
    const image = screen.getByRole('img')
    Object.defineProperty(image, 'currentSrc', { configurable: true, value: memory.displayUrl })
    fireEvent.error(image)
    expect(screen.getByRole('img')).toHaveAttribute('src', memory.thumbnailUrl)
    expect(screen.getByRole('img')).not.toHaveAttribute('srcset')
  })

  it('recovers when refreshed signed image URLs arrive', () => {
    const view = render(card())
    fireEvent.error(screen.getByRole('img'))
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    view.rerender(card({ ...memory, thumbnailUrl: `${memory.thumbnailUrl}?fresh=1`, displayUrl: `${memory.displayUrl}?fresh=1` }))
    expect(screen.getByRole('img')).toHaveAttribute('src', `${memory.thumbnailUrl}?fresh=1`)
  })

  it('does not download original videos merely to display a gallery card', () => {
    const video = { ...memory, mediaType: 'video' as const, thumbnailUrl: '', displayUrl: 'https://media.test/large-original.mp4', durationSeconds: 73 }
    const view = render(card(video))
    expect(view.container.querySelector('video')).toBeNull()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('1:13')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open video/i })).toBeInTheDocument()
  })

  it('can display a photo when only its display derivative is available', () => {
    render(card({ ...memory, thumbnailUrl: '' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', memory.displayUrl)
    expect(screen.getByRole('img')).not.toHaveAttribute('srcset')
  })
})
