import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const retired = vi.hoisted(() => ({ Guestbook: vi.fn(() => null), GreetingComposer: vi.fn(() => null) }))
vi.mock('./components/guestbook/Guestbook', () => ({ Guestbook: retired.Guestbook }))
vi.mock('./components/guestbook/GreetingComposer', () => ({ GreetingComposer: retired.GreetingComposer }))
vi.mock('./components/gallery/GalleryGrid', () => ({ GalleryGrid: () => <div data-testid="gallery-grid">Wedding photos and videos</div> }))
vi.mock('./components/upload/UploadExperience', () => ({ UploadExperience: () => null }))
vi.mock('./pages/PolaroidPage', () => ({ default: () => <main data-testid="photobooth-page">The wedding photo booth</main> }))

describe('retired guestbook route', () => {
  afterEach(() => { window.history.replaceState({}, '', '/'); vi.clearAllMocks() })

  it('redirects the old guestbook URL to the gallery without mounting a guestbook or composer', async () => {
    window.history.replaceState({}, '', '/guestbook')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/gallery'))
    expect(await screen.findByTestId('gallery-grid')).toBeInTheDocument()
    expect(retired.Guestbook).not.toHaveBeenCalled()
    expect(retired.GreetingComposer).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /leave a greeting|tulis ucapan/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /guestbook|buku tetamu/i })).not.toBeInTheDocument()
  })
})

describe('photo booth routes', () => {
  afterEach(() => { window.history.replaceState({}, '', '/'); vi.clearAllMocks() })

  it('opens the lazily loaded photo booth at its canonical URL', async () => {
    window.history.replaceState({}, '', '/photobooth')
    render(<App />)

    expect(await screen.findByTestId('photobooth-page')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/photobooth')
    expect(screen.queryByTestId('gallery-grid')).not.toBeInTheDocument()
  })

  it('redirects the legacy Polaroid URL to the canonical photo booth URL', async () => {
    window.history.replaceState({}, '', '/polaroid')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/photobooth'))
    expect(await screen.findByTestId('photobooth-page')).toBeInTheDocument()
    expect(screen.queryByTestId('gallery-grid')).not.toBeInTheDocument()
  })
})
