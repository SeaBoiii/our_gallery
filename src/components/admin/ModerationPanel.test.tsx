import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminMedia } from '../../../shared/contracts'
import { ModerationPanel } from './ModerationPanel'

const api = vi.hoisted(() => ({
  deleteAdminMedia: vi.fn(),
  getAdminMedia: vi.fn(),
  updateAdminMedia: vi.fn(),
}))

vi.mock('../../services/api', () => api)

const memory = (id: string, status: AdminMedia['status'] = 'pending'): AdminMedia => ({
  id,
  eventSlug: 'solemnisation',
  eventDisplayName: 'Solemnisation',
  mediaType: 'photo',
  mimeType: 'image/jpeg',
  originalFilename: `${id}.jpg`,
  guestName: 'Guest',
  guestMessage: null,
  status,
  derivativeStatus: 'ready',
  sizeBytes: 1024,
  createdAt: '2027-08-21T12:00:00.000Z',
  thumbnailUrl: '/sample.webp',
  originalDownloadUrl: '/original.jpg',
})

describe('moderation panel', () => {
  beforeEach(() => {
    api.deleteAdminMedia.mockReset()
    api.getAdminMedia.mockReset()
    api.updateAdminMedia.mockReset()
  })

  it('makes the next cursor reachable with a load-more control', async () => {
    api.getAdminMedia
      .mockResolvedValueOnce({ items: [memory('first')], nextCursor: 'next-page' })
      .mockResolvedValueOnce({ items: [memory('second')], nextCursor: null })

    render(<ModerationPanel />)

    expect(await screen.findByText('first.jpg · 1 KB · Derivatives: ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more arrivals' }))

    expect(await screen.findByText('second.jpg · 1 KB · Derivatives: ready')).toBeInTheDocument()
    expect(api.getAdminMedia).toHaveBeenLastCalledWith({ status: 'pending', event: undefined, type: undefined, cursor: 'next-page' })
    expect(screen.getByText('End of the current results')).toBeInTheDocument()
  })

  it('locks a moderation mutation and reports failures without changing the item', async () => {
    let rejectUpdate: ((reason?: unknown) => void) | undefined
    api.getAdminMedia.mockResolvedValue({ items: [memory('locked')], nextCursor: null })
    api.updateAdminMedia.mockReturnValue(new Promise((_, reject) => { rejectUpdate = reject }))

    render(<ModerationPanel />)
    await screen.findByText('locked.jpg · 1 KB · Derivatives: ready')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select locked.jpg' }))
    const approve = screen.getByText('Approve').closest('button') as HTMLButtonElement
    fireEvent.click(approve)
    fireEvent.click(approve)

    expect(api.updateAdminMedia).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Approving 1 memory')

    await act(async () => { rejectUpdate?.(new Error('Network unavailable')) })

    expect(await screen.findByRole('alert')).toHaveTextContent('not updated')
    expect(screen.getByText('locked.jpg · 1 KB · Derivatives: ready')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select locked.jpg' })).toBeChecked())
  })

  it('copies a stable public-gallery link for approved media', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    api.getAdminMedia.mockResolvedValue({ items: [memory('approved-memory', 'approved')], nextCursor: null })

    render(<ModerationPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy approved media link' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://gallery.aleemxnurul.love/gallery?memory=approved-memory'))
    expect(screen.getByRole('button', { name: 'Public link copied' })).toBeInTheDocument()
  })
})
