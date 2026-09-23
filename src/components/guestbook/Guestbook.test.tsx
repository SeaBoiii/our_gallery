import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../context/LocaleContext'
import { Guestbook } from './Guestbook'

const api = vi.hoisted(() => ({ getGreetings: vi.fn() }))
vi.mock('../../services/api', () => api)
vi.mock('./GreetingComposer', () => ({ GreetingComposer: () => null }))

const greeting = (id: string, message: string) => ({ id, guestName: null, message, createdAt: '2027-08-21T12:00:00.000Z' })
const renderGuestbook = (onLeaveGreeting = vi.fn()) => render(<LocaleProvider><Guestbook onLeaveGreeting={onLeaveGreeting} /></LocaleProvider>)

describe('public guestbook', () => {
  beforeEach(() => api.getGreetings.mockReset())

  it('renders plain text wishes safely and retains them after a pagination failure', async () => {
    api.getGreetings.mockResolvedValueOnce({ items: [greeting('one', '<img src=x onerror=alert(1)>')], nextCursor: 'page-two', submissionsOpen: true }).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ items: [greeting('one', '<img src=x onerror=alert(1)>'), greeting('two', 'Forever happy.')], nextCursor: null, submissionsOpen: true })
    const { container } = renderGuestbook()
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('blockquote img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Read more greetings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be opened')
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Forever happy.')).toBeInTheDocument()
    expect(screen.getAllByText('<img src=x onerror=alert(1)>')).toHaveLength(1)
    expect(api.getGreetings).toHaveBeenLastCalledWith({ cursor: 'page-two', limit: 6 })
  })

  it('shows the empty state and opens the shared greeting composer from its CTA', async () => {
    api.getGreetings.mockResolvedValue({ items: [], nextCursor: null, submissionsOpen: true })
    const onLeave = vi.fn()
    renderGuestbook(onLeave)
    expect(await screen.findByText('Be the first to leave a little love.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Leave a greeting' }))
    expect(onLeave).toHaveBeenCalledOnce()
  })

  it('keeps approved greetings readable when new submissions are closed', async () => {
    api.getGreetings.mockResolvedValue({ items: [greeting('one', 'A note to keep.')], nextCursor: null, submissionsOpen: false })
    renderGuestbook()
    expect(await screen.findByText('A note to keep.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('closed to new greetings')
    expect(screen.queryByRole('button', { name: 'Leave a greeting' })).not.toBeInTheDocument()
  })

  it('offers retry after an initial load error', async () => {
    api.getGreetings.mockRejectedValueOnce(new Error('private technical message')).mockResolvedValueOnce({ items: [], nextCursor: null, submissionsOpen: true })
    renderGuestbook()
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again')
    expect(screen.queryByText('private technical message')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Be the first to leave a little love.')).toBeInTheDocument()
  })
})
