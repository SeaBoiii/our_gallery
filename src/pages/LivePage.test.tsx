import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GalleryPage } from '../../shared/contracts'
import { LocaleProvider } from '../context/LocaleContext'
import { mockGallery } from '../data/mock'
import { publicConfig, TestVisibilityProvider } from '../test/visibility'
import LivePage from './LivePage'

const api = vi.hoisted(() => ({ getGallery: vi.fn(), getLiveConfig: vi.fn() }))
vi.mock('../services/api', () => api)
const tree = (mode: 'both' | 'solemnisation' | null) => <LocaleProvider><TestVisibilityProvider config={mode ? publicConfig({ mode }) : null}><LivePage /></TestVisibilityProvider></LocaleProvider>

describe('live wall visibility', () => {
  beforeEach(() => { api.getGallery.mockReset(); api.getLiveConfig.mockReset() })

  it('intersects a configured hidden source with the visible day and suppresses hidden media and date controls', async () => {
    api.getLiveConfig.mockResolvedValue({ source: 'reception' })
    api.getGallery.mockResolvedValue({ items: [mockGallery[0], mockGallery[2]], nextCursor: null })
    render(tree('solemnisation'))
    expect(await screen.findByRole('img', { name: mockGallery[0].guestMessage! })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: mockGallery[2].guestMessage! })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '22 August' })).not.toBeInTheDocument()
    expect(api.getGallery).toHaveBeenLastCalledWith({ event: 'solemnisation', limit: 50 })
  })

  it('clears an existing live image and rejects a late old-policy page after visibility fails', async () => {
    let resolve!: (page: GalleryPage) => void
    api.getLiveConfig.mockResolvedValue({ source: 'all' })
    api.getGallery.mockReturnValue(new Promise<GalleryPage>(done => { resolve = done }))
    const view = render(tree('both'))
    await waitFor(() => expect(api.getGallery).toHaveBeenCalled())
    view.rerender(tree(null))
    await act(async () => resolve({ items: [mockGallery[2]], nextCursor: null }))
    expect(screen.getByRole('alert')).toHaveTextContent('The gallery is temporarily unavailable')
    expect(document.querySelector('.live-media')).not.toBeInTheDocument()
    expect(screen.queryByText(/22 August/)).not.toBeInTheDocument()
  })

  it('clears media when live-source refresh fails', async () => {
    let reject!: (error: Error) => void
    api.getLiveConfig.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    api.getGallery.mockResolvedValue({ items: [mockGallery[0]], nextCursor: null })
    render(tree('both'))
    expect(await screen.findByRole('img', { name: mockGallery[0].guestMessage! })).toBeInTheDocument()
    await act(async () => reject(new Error('offline')))
    expect(document.querySelector('.live-media')).not.toBeInTheDocument()
    expect(screen.getAllByText('Reconnecting…').length).toBeGreaterThan(0)
  })
})
