import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../context/LocaleContext'
import { HomePage } from './HomePage'
import { TestVisibilityProvider } from '../test/visibility'

vi.mock('../components/gallery/GalleryGrid', () => ({
  GalleryGrid: () => {
    const location = useLocation()
    return <div data-testid="gallery-grid" data-pathname={location.pathname} data-search={location.search}>Approved photo collection</div>
  },
}))
vi.mock('../components/upload/UploadExperience', () => ({
  UploadExperience: ({ open, initialFiles, onClose, onViewGallery }: { open: boolean; initialFiles: File[]; onClose: () => void; onViewGallery: () => void }) => open
    ? <div role="dialog" aria-label="Upload composer"><span>{initialFiles.map(file => file.name).join(', ')}</span><button type="button" onClick={onClose}>Close upload composer</button><button type="button" onClick={onViewGallery}>View uploaded memories</button></div>
    : null,
}))

const originalScrollIntoView = Element.prototype.scrollIntoView
function homePage(path: string) {
  const user = userEvent.setup()
  render(<LocaleProvider><TestVisibilityProvider><MemoryRouter initialEntries={[path]}><HomePage /></MemoryRouter></TestVisibilityProvider></LocaleProvider>)
  return user
}
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { Element.prototype.scrollIntoView = originalScrollIntoView })

describe('gallery journal navigation', () => {
  it('opens the uploader from header and hero, and returns completed uploads to the gallery', async () => {
    const user = homePage('/')
    const header = screen.getByRole('navigation', { name: 'Primary navigation' })
    await user.click(within(header).getByRole('button', { name: 'Share a memory' }))
    const upload = screen.getByRole('dialog', { name: 'Upload composer' })
    await user.click(within(upload).getByRole('button', { name: 'View uploaded memories' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('gallery-grid')).toHaveAttribute('data-pathname', '/gallery')
    const hero = screen.getByRole('region', { name: /Our journey,\s*through your eyes\./ })
    expect(within(hero).getByRole('link', { name: 'Explore the gallery' })).toHaveAttribute('href', '#gallery')
    await user.click(within(hero).getByRole('button', { name: 'Share a memory' }))
    expect(screen.getByRole('dialog', { name: 'Upload composer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /greeting/i })).not.toBeInTheDocument()
  })

  it('preserves the gallery and selected memory while translating the front page', async () => {
    const memoryId = '52d0b802-1bee-48be-bb11-d8a2331f9e09'
    const user = homePage(`/gallery?memory=${memoryId}`)
    await user.click(screen.getByRole('button', { name: 'Tukar ke Bahasa Melayu' }))
    const hero = screen.getByRole('region', { name: /Perjalanan kami,\s*melalui mata anda\./ })
    expect(within(hero).getByRole('button', { name: 'Kongsi kenangan' })).toBeInTheDocument()
    expect(within(hero).getByRole('link', { name: 'Terokai galeri' })).toHaveAttribute('href', '#gallery')
    expect(screen.getByTestId('gallery-grid')).toHaveAttribute('data-search', `?memory=${memoryId}`)
    expect(screen.getByRole('heading', { name: 'Detik yang kita kenang.' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Switch to English' }))
    expect(screen.getByRole('heading', { name: 'The moments in between.' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })

  it('passes camera and library files to the uploader without retaining an old selection', async () => {
    const user = homePage('/')
    const camera = document.querySelector<HTMLInputElement>('input[capture="environment"]')!
    const library = document.querySelector<HTMLInputElement>('input[multiple]')!
    const cameraFile = new File(['camera'], 'camera.jpg', { type: 'image/jpeg' })
    await user.upload(camera, cameraFile)
    expect(within(screen.getByRole('dialog')).getByText('camera.jpg')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close upload composer' }))
    await user.upload(library, [new File(['film'], 'celebration.mp4', { type: 'video/mp4' })])
    expect(within(screen.getByRole('dialog')).getByText('celebration.mp4')).toBeInTheDocument()
    expect(screen.queryByText('camera.jpg')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close upload composer' }))
    await user.click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Share a memory' }))
    expect(screen.queryByText('celebration.mp4')).not.toBeInTheDocument()
  })
})
