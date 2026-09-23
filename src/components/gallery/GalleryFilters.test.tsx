import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GalleryFilters } from './GalleryFilters'
import { LocaleProvider } from '../../context/LocaleContext'

describe('gallery filters', () => {
  it('emits independent day and media filters', () => {
    const change = vi.fn()
    render(<LocaleProvider><GalleryFilters value={{ event: 'all', type: 'all' }} onChange={change} /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button', { name: '21 August' }))
    expect(change).toHaveBeenCalledWith({ event: 'solemnisation', type: 'all' })
    fireEvent.click(screen.getByRole('button', { name: 'Videos' }))
    expect(change).toHaveBeenCalledWith({ event: 'all', type: 'video' })
  })

  it('identifies the selected chapter without resetting the media filter', () => {
    const change = vi.fn()
    render(<LocaleProvider><GalleryFilters value={{ event: 'solemnisation', type: 'photo' }} onChange={change} /></LocaleProvider>)
    expect(screen.getByRole('button', { name: '21 August' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All moments' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: '22 August' }))
    expect(change).toHaveBeenCalledWith({ event: 'reception', type: 'photo' })
  })

  it('labels chapters and dates in Bahasa Melayu', () => {
    window.localStorage.setItem('an-gallery-locale', 'ms')
    render(<LocaleProvider><GalleryFilters value={{ event: 'all', type: 'all' }} onChange={vi.fn()} /></LocaleProvider>)
    expect(screen.getByRole('button', { name: 'Semua detik' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '21 Ogos' })).toBeInTheDocument()
    expect(screen.getAllByText('Perkahwinan Kami')).toHaveLength(3)
  })
})
