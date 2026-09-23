import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const retired = vi.hoisted(() => ({ Guestbook: vi.fn(() => null), GreetingComposer: vi.fn(() => null) }))
vi.mock('./components/guestbook/Guestbook', () => ({ Guestbook: retired.Guestbook }))
vi.mock('./components/guestbook/GreetingComposer', () => ({ GreetingComposer: retired.GreetingComposer }))
vi.mock('./components/gallery/GalleryGrid', () => ({ GalleryGrid: () => <div data-testid="gallery-grid">Wedding photos and videos</div> }))
vi.mock('./components/upload/UploadExperience', () => ({ UploadExperience: () => null }))

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
