import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

const api = vi.hoisted(() => ({ getAdminSettings: vi.fn(), updateAdminSettings: vi.fn() }))
vi.mock('../../services/api', () => api)

describe('guestbook setting', () => {
  it('defaults an omitted greeting flag to enabled and only updates that flag', async () => {
    const settings = { uploadsEnabled: false, autoApproveUploads: true, liveWallSource: 'all', events: [] }
    api.getAdminSettings.mockResolvedValue(settings)
    api.updateAdminSettings.mockResolvedValue({ ...settings, greetingsEnabled: false })
    render(<MemoryRouter><SettingsPanel /></MemoryRouter>)
    const toggle = await screen.findByRole('checkbox', { name: /Guest greetings/ })
    expect(toggle).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Guest uploads/ })).not.toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(api.updateAdminSettings).toHaveBeenCalledWith({ greetingsEnabled: false }))
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Auto-approve uploads/ })).toBeChecked()
  })
})
