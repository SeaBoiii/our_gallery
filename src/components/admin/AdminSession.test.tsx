import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AdminPage from '../../pages/AdminPage'

const api = vi.hoisted(() => ({ getAdminSession: vi.fn(), adminLogin: vi.fn(), adminLogout: vi.fn(), ADMIN_SESSION_EXPIRED_EVENT: 'gallery-admin-session-expired' }))
vi.mock('../../services/api', () => api)
vi.mock('./AdminOverview', () => ({ AdminOverview: () => <h1>Test dashboard</h1> }))
vi.mock('./ModerationPanel', () => ({ ModerationPanel: () => null }))
vi.mock('./SettingsPanel', () => ({ SettingsPanel: () => null }))

describe('admin session expiry', () => {
  it('returns an expired session to sign-in and allows reauthentication', async () => {
    api.getAdminSession.mockResolvedValue({ authenticated: true })
    api.adminLogin.mockResolvedValue({ authenticated: true })
    render(<MemoryRouter><AdminPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Test dashboard' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Overview', 'Moderation', 'Settings', 'Sign out'])
    expect(screen.queryByRole('button', { name: /greetings|guestbook/i })).not.toBeInTheDocument()
    act(() => { window.dispatchEvent(new Event(api.ADMIN_SESSION_EXPIRED_EVENT)) })
    expect(await screen.findByRole('status')).toHaveTextContent('Your admin session has ended')
    expect(screen.queryByRole('heading', { name: 'Test dashboard' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'a-test-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open gallery dashboard' }))
    expect(await screen.findByRole('heading', { name: 'Test dashboard' })).toBeInTheDocument()
    expect(api.adminLogin).toHaveBeenCalledWith('a-test-password')
  })
})
