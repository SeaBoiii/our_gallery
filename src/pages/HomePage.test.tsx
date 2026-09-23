import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../context/LocaleContext'
import { HomePage } from './HomePage'

const api = vi.hoisted(() => ({ getGreetings: vi.fn() }))
vi.mock('../services/api', () => api)
vi.mock('../components/gallery/GalleryGrid', () => ({
  GalleryGrid: () => {
    const location = useLocation()
    return <div data-testid="gallery-grid" data-pathname={location.pathname} data-search={location.search}>Approved photo collection</div>
  },
}))
vi.mock('../components/guestbook/GreetingComposer', () => ({
  GreetingComposer: ({ open, onClose }: { open: boolean; onClose: () => void }) => open
    ? <div role="dialog" aria-label="Greeting composer"><button type="button" onClick={onClose}>Close greeting composer</button></div>
    : null,
}))
vi.mock('../components/upload/UploadExperience', () => ({
  UploadExperience: ({ open, onClose, onViewGallery }: { open: boolean; onClose: () => void; onViewGallery: () => void }) => open
    ? <div role="dialog" aria-label="Upload composer"><button type="button" onClick={onClose}>Close upload composer</button><button type="button" onClick={onViewGallery}>View uploaded memories</button></div>
    : null,
}))

const originalScrollIntoView = Element.prototype.scrollIntoView

function homePage(path: string) {
  const user = userEvent.setup()
  render(<LocaleProvider><MemoryRouter initialEntries={[path]}><HomePage /></MemoryRouter></LocaleProvider>)
  return user
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  api.getGreetings.mockReset().mockResolvedValue({
    items: [{ id: 'greeting-1', guestName: 'Auntie Mariam', message: 'A lifetime of happiness for you both.', createdAt: '2027-08-21T01:00:00.000Z' }],
    nextCursor: null,
    submissionsOpen: true,
  })
})

afterEach(() => { Element.prototype.scrollIntoView = originalScrollIntoView })

describe('public wedding collection navigation', () => {
  it('switches between the gallery and approved guestbook through the collection links', async () => {
    const user = homePage('/gallery')
    const collection = screen.getByRole('navigation', { name: 'Wedding collection' })
    expect(screen.getByTestId('gallery-grid')).toBeInTheDocument()
    expect(within(collection).getByRole('link', { name: 'The gallery' })).toHaveAttribute('aria-current', 'page')

    await user.click(within(collection).getByRole('link', { name: 'The guestbook' }))
    expect(await screen.findByText('A lifetime of happiness for you both.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A few words, forever kept.' })).toBeInTheDocument()
    expect(screen.queryByTestId('gallery-grid')).not.toBeInTheDocument()
    expect(within(collection).getByRole('link', { name: 'The guestbook' })).toHaveAttribute('aria-current', 'page')

    await user.click(within(collection).getByRole('link', { name: 'The gallery' }))
    expect(screen.getByTestId('gallery-grid')).toHaveAttribute('data-pathname', '/gallery')
    expect(screen.getByRole('heading', { name: 'The moments in between.' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'A few words, forever kept.' })).not.toBeInTheDocument()
  })

  it('opens the right contribution dialog from header and hero actions and returns uploads to the gallery', async () => {
    const user = homePage('/guestbook')
    await screen.findByText('A lifetime of happiness for you both.')
    const header = screen.getByRole('navigation', { name: 'Primary navigation' })
    await user.click(within(header).getByRole('button', { name: 'Share a memory' }))
    const upload = screen.getByRole('dialog', { name: 'Upload composer' })
    expect(screen.queryByRole('dialog', { name: 'Greeting composer' })).not.toBeInTheDocument()
    await user.click(within(upload).getByRole('button', { name: 'View uploaded memories' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('gallery-grid')).toHaveAttribute('data-pathname', '/gallery')

    const hero = screen.getByRole('region', { name: /Our day,\s*through your eyes\./ })
    await user.click(within(hero).getByRole('button', { name: 'Leave a greeting' }))
    expect(screen.getByRole('dialog', { name: 'Greeting composer' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Upload composer' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close greeting composer' }))
    await user.click(within(hero).getByRole('button', { name: 'Share photos & videos' }))
    expect(screen.getByRole('dialog', { name: 'Upload composer' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Greeting composer' })).not.toBeInTheDocument()
  })

  it('keeps the selected view while language changes and translates navigation and contribution labels', async () => {
    const user = homePage('/guestbook')
    await screen.findByText('A lifetime of happiness for you both.')
    await user.click(screen.getByRole('button', { name: 'Tukar ke Bahasa Melayu' }))
    const collection = screen.getByRole('navigation', { name: 'Koleksi perkahwinan' })
    expect(within(collection).getByRole('link', { name: 'Buku tetamu' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Sepatah kata, kenangan selamanya.' })).toBeInTheDocument()
    expect(screen.queryByTestId('gallery-grid')).not.toBeInTheDocument()
    const hero = screen.getByRole('region', { name: /Hari kami,\s*melalui mata anda\./ })
    expect(within(hero).getByRole('button', { name: 'Tulis ucapan' })).toBeInTheDocument()
    expect(within(hero).getByRole('button', { name: 'Kongsi foto & video' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Navigasi utama' })).getByRole('button', { name: 'Kongsi kenangan' })).toBeInTheDocument()

    await user.click(within(collection).getByRole('link', { name: 'Galeri' }))
    expect(screen.getByRole('heading', { name: 'Detik yang kita kenang.' })).toBeInTheDocument()
    expect(screen.getByTestId('gallery-grid')).toHaveAttribute('data-pathname', '/gallery')
    await user.click(screen.getByRole('button', { name: 'Switch to English' }))
    expect(screen.getByRole('heading', { name: 'The moments in between.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'The gallery' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('heading', { name: 'A few words, forever kept.' })).not.toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })

  it('preserves a shared memory query when opening the gallery route', () => {
    const memoryId = '52d0b802-1bee-48be-bb11-d8a2331f9e09'
    homePage(`/gallery?memory=${memoryId}`)
    const grid = screen.getByTestId('gallery-grid')
    expect(grid).toHaveAttribute('data-pathname', '/gallery')
    expect(grid).toHaveAttribute('data-search', `?memory=${memoryId}`)
    expect(screen.getByRole('link', { name: 'The gallery' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('heading', { name: 'A few words, forever kept.' })).not.toBeInTheDocument()
  })
})
