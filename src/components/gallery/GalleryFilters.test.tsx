import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GalleryFilters } from './GalleryFilters'
import { LocaleProvider } from '../../context/LocaleContext'

describe('gallery filters', () => {
  it('emits independent day and media filters', () => {
    const change = vi.fn()
    render(<LocaleProvider><GalleryFilters value={{ event: 'all', type: 'all' }} onChange={change} /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button', { name: '21 Aug' }))
    expect(change).toHaveBeenCalledWith({ event: 'solemnisation', type: 'all' })
    fireEvent.click(screen.getByRole('button', { name: 'Videos' }))
    expect(change).toHaveBeenCalledWith({ event: 'all', type: 'video' })
  })
})
