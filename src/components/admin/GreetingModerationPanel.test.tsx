import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminGreeting } from '../../../shared/contracts'
import { GreetingModerationPanel } from './GreetingModerationPanel'

const api = vi.hoisted(() => ({ getAdminGreetings: vi.fn(), getAdminGreetingStats: vi.fn(), updateAdminGreetings: vi.fn(), deleteAdminGreeting: vi.fn() }))
vi.mock('../../services/api', () => api)
const greeting = (id: string, name: string, status: AdminGreeting['status'] = 'pending'): AdminGreeting => ({ id, guestName: name, message: `A wish from ${name}.`, status, createdAt: '2027-08-21T12:00:00.000Z' })

describe('greeting moderation', () => {
  beforeEach(() => {
    Object.values(api).forEach((method) => method.mockReset())
    api.getAdminGreetingStats.mockResolvedValue({ pending: 1, approved: 0, rejected: 0, total: 1 })
  })
  afterEach(() => vi.restoreAllMocks())

  it('approves selected wishes and reloads the authoritative queue and counts', async () => {
    api.getAdminGreetings.mockResolvedValueOnce({ items: [greeting('one', 'Nur')], nextCursor: null }).mockResolvedValueOnce({ items: [], nextCursor: null })
    api.updateAdminGreetings.mockResolvedValue({ updated: 1 })
    render(<GreetingModerationPanel />)
    await screen.findByText('A wish from Nur.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select greeting from Nur' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))
    expect(await screen.findByText('1 greeting approved.')).toBeInTheDocument()
    expect(api.updateAdminGreetings).toHaveBeenCalledWith(['one'], 'approved')
    expect(screen.queryByText('A wish from Nur.')).not.toBeInTheDocument()
    expect(api.getAdminGreetingStats).toHaveBeenCalledTimes(2)
  })

  it('locks repeated updates and keeps selection after an error', async () => {
    let rejectUpdate: ((reason: Error) => void) | undefined
    api.getAdminGreetings.mockResolvedValue({ items: [greeting('one', 'Nur')], nextCursor: null })
    api.updateAdminGreetings.mockReturnValue(new Promise((_, reject) => { rejectUpdate = reject }))
    render(<GreetingModerationPanel />)
    await screen.findByText('A wish from Nur.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select greeting from Nur' }))
    const reject = screen.getByRole('button', { name: 'Reject selected' })
    fireEvent.click(reject)
    fireEvent.click(reject)
    expect(api.updateAdminGreetings).toHaveBeenCalledOnce()
    await act(async () => { rejectUpdate?.(new Error('Database detail that should not reach guests')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('selection is still here')
    expect(screen.getByRole('checkbox', { name: 'Select greeting from Nur' })).toBeChecked()
    expect(screen.getByText('A wish from Nur.')).toBeInTheDocument()
  })

  it('loads subsequent pages and removes deleted greetings after confirmation', async () => {
    api.getAdminGreetings.mockResolvedValueOnce({ items: [greeting('one', 'Nur')], nextCursor: 'two' }).mockResolvedValueOnce({ items: [greeting('two', 'Hana')], nextCursor: null }).mockResolvedValueOnce({ items: [greeting('one', 'Nur')], nextCursor: null })
    api.deleteAdminGreeting.mockResolvedValue({ deleted: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<GreetingModerationPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more greetings' }))
    expect(await screen.findByText('A wish from Hana.')).toBeInTheDocument()
    expect(api.getAdminGreetings).toHaveBeenLastCalledWith({ status: 'pending', cursor: 'two' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete greeting from Hana' }))
    await waitFor(() => expect(api.deleteAdminGreeting).toHaveBeenCalledWith('two'))
    expect(await screen.findByText('Greeting deleted.')).toBeInTheDocument()
    expect(screen.queryByText('A wish from Hana.')).not.toBeInTheDocument()
  })

  it('caps batch selection at the API limit while allowing selected greetings to be deselected', async () => {
    api.getAdminGreetings.mockResolvedValue({ items: Array.from({ length: 101 }, (_, index) => greeting(String(index), `Guest ${index}`)), nextCursor: null })
    render(<GreetingModerationPanel />)
    await screen.findByText('A wish from Guest 100.')
    const choices = screen.getAllByRole('checkbox')
    act(() => {
      for (const checkbox of choices.slice(0, 99)) fireEvent.click(checkbox)
    })
    expect(screen.getByText('99 selected')).toBeInTheDocument()
    expect(choices[100]).toBeEnabled()
    fireEvent.click(choices[99])
    expect(screen.getByText('100 selected')).toBeInTheDocument()
    expect(choices[100]).toBeDisabled()
    expect(choices[0]).toBeEnabled()
    fireEvent.click(choices[0])
    expect(choices[100]).toBeEnabled()
    // This integration case performs 101 controlled-input interactions; allow
    // headroom while the entire jsdom suite is running concurrently.
  }, 15_000)
})
