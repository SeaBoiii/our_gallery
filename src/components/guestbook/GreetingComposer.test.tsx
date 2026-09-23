import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../context/LocaleContext'
import { GalleryApiError } from '../../services/api'
import { GreetingComposer } from './GreetingComposer'

const api = vi.hoisted(() => ({ createGreeting: vi.fn(), getGreetings: vi.fn() }))
vi.mock('../../services/api', async (importOriginal) => ({ ...await importOriginal<typeof import('../../services/api')>(), ...api }))
vi.mock('../upload/TurnstileWidget', () => ({
  TurnstileWidget: ({ onToken, resetKey, action }: { onToken: (token: string) => void; resetKey: number; action: string }) => {
    useEffect(() => { onToken(`verified-${resetKey}`) }, [onToken, resetKey])
    return <span data-testid="verification" data-action={action}>{resetKey}</span>
  },
}))

function composer() {
  const onClose = vi.fn()
  const onSubmitted = vi.fn()
  const result = render(<LocaleProvider><GreetingComposer open onClose={onClose} onSubmitted={onSubmitted} /></LocaleProvider>)
  return { ...result, onClose, onSubmitted }
}

describe('greeting composer', () => {
  beforeEach(() => {
    api.createGreeting.mockReset()
    api.getGreetings.mockReset().mockResolvedValue({ items: [], nextCursor: null, submissionsOpen: true })
  })

  it('keeps the same request after an uncertain failure, gets a fresh token, and renews the request after edits', async () => {
    api.createGreeting.mockRejectedValueOnce(new GalleryApiError('Private internal error', 'NETWORK_ERROR', true)).mockRejectedValueOnce(new GalleryApiError('Private internal error', 'HTTP_503', true)).mockResolvedValue({ id: 'greeting-1', status: 'pending' })
    const { onSubmitted } = composer()
    fireEvent.change(screen.getByLabelText('Your greeting'), { target: { value: 'A lifetime of happiness for you both.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send with love' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your words are saved here')
    const first = api.createGreeting.mock.calls[0][0]
    expect(screen.queryByText('Private internal error')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Your greeting')).toHaveValue(first.message)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send with love' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send with love' }))
    await waitFor(() => expect(api.createGreeting).toHaveBeenCalledTimes(2))
    const second = api.createGreeting.mock.calls[1][0]
    expect(second.requestId).toBe(first.requestId)
    expect(second.turnstileToken).not.toBe(first.turnstileToken)
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send with love' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Your greeting'), { target: { value: 'A lifetime of happiness and beautiful adventures.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send with love' }))
    expect(await screen.findByRole('status')).toHaveTextContent('awaiting review')
    expect(api.createGreeting.mock.calls[2][0].requestId).not.toBe(first.requestId)
    expect(onSubmitted).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Your greeting')).not.toBeInTheDocument()
  })

  it('accepts an anonymous greeting, locks duplicate sends, and reports pending review', async () => {
    let resolveSubmission: ((value: { id: string; status: string }) => void) | undefined
    api.createGreeting.mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve }))
    composer()
    expect(screen.getByTestId('verification')).toHaveAttribute('data-action', 'greeting_submit')
    expect(screen.getByLabelText('Your name', { exact: false })).toHaveAttribute('maxlength', '80')
    expect(screen.getByLabelText('Your greeting')).toHaveAttribute('maxlength', '1000')
    fireEvent.change(screen.getByLabelText('Your greeting'), { target: { value: '  With love to you both.  ' } })
    const send = screen.getByRole('button', { name: 'Send with love' })
    fireEvent.click(send)
    fireEvent.click(send)
    expect(api.createGreeting).toHaveBeenCalledOnce()
    expect(api.createGreeting.mock.calls[0][0]).toMatchObject({ guestName: undefined, message: 'With love to you both.' })
    expect(screen.getByRole('button', { name: 'Close greeting' })).toBeDisabled()
    await act(async () => { resolveSubmission?.({ id: 'new', status: 'pending' }) })
    expect(await screen.findByRole('status')).toHaveTextContent('once approved')
  })

  it('rejects whitespace-only messages and retains the draft when submission closes', async () => {
    api.createGreeting.mockRejectedValue(new GalleryApiError('Closed', 'GREETINGS_CLOSED'))
    composer()
    fireEvent.change(screen.getByLabelText('Your greeting'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send with love' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please write a greeting')
    expect(api.createGreeting).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Your greeting'), { target: { value: 'Saved words.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send with love' }))
    expect(await screen.findByRole('status')).toHaveTextContent('closed to new greetings')
    expect(screen.queryByRole('button', { name: 'Send with love' })).not.toBeInTheDocument()
  })

  it('provides Malay content and a clear closed state', async () => {
    window.localStorage.setItem('an-gallery-locale', 'ms')
    api.getGreetings.mockResolvedValue({ items: [], nextCursor: null, submissionsOpen: false })
    composer()
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Ikhlas, daripada anda.')
    expect(await screen.findByRole('status')).toHaveTextContent('Buku tetamu telah ditutup')
    expect(screen.queryByRole('button', { name: 'Hantar dengan kasih' })).not.toBeInTheDocument()
  })
})
