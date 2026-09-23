import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

const api = vi.hoisted(() => ({ getAdminSettings: vi.fn(), updateAdminSettings: vi.fn() }))
vi.mock('../../services/api', () => api)

describe('gallery settings', () => {
  it('shows only media controls and updates uploads without reviving a legacy greeting flag', async () => {
    const settings = { uploadsEnabled: false, autoApproveUploads: true, greetingsEnabled: true, liveWallSource: 'all', events: [] }
    api.getAdminSettings.mockResolvedValue(settings)
    api.updateAdminSettings.mockResolvedValue({ ...settings, uploadsEnabled: true })
    render(<MemoryRouter><SettingsPanel /></MemoryRouter>)
    const toggle = await screen.findByRole('checkbox', { name: /Guest uploads/ })
    expect(toggle).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /greeting/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Guestbook')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    await waitFor(() => expect(api.updateAdminSettings).toHaveBeenCalledWith({ uploadsEnabled: true }))
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    expect(toggle).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Auto-approve uploads/ })).toBeChecked()
  })
})
