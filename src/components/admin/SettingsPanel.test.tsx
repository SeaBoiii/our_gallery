import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'
import { TestVisibilityProvider } from '../../test/visibility'
import { DEFAULT_GALLERY_VISIBILITY, resolveGalleryVisibility } from '../../../shared/visibility'

const api = vi.hoisted(() => ({ getAdminSettings: vi.fn(), updateAdminSettings: vi.fn() }))
vi.mock('../../services/api', () => api)

describe('gallery settings', () => {
  it('shows only media controls and updates uploads without reviving a legacy greeting flag', async () => {
    const settings = { visibility: resolveGalleryVisibility(DEFAULT_GALLERY_VISIBILITY), uploadsEnabled: false, autoApproveUploads: true, greetingsEnabled: true, liveWallSource: 'all', events: [] }
    api.getAdminSettings.mockResolvedValue(settings)
    api.updateAdminSettings.mockResolvedValue({ ...settings, uploadsEnabled: true })
    render(<TestVisibilityProvider><MemoryRouter><SettingsPanel /></MemoryRouter></TestVisibilityProvider>)
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

  it('includes and disables both individual dates until Both days is turned off, then restores the last single date', async () => {
    const visibility = resolveGalleryVisibility({ control: 'manual', mode: 'both', lastSingleDay: 'reception', overrideUntil: null })
    const settings = { visibility, uploadsEnabled: true, autoApproveUploads: false, liveWallSource: 'all', events: [] }
    api.getAdminSettings.mockResolvedValue(settings)
    api.updateAdminSettings.mockResolvedValue({ ...settings, visibility: { ...visibility, mode: 'reception', effectiveMode: 'reception' } })
    render(<TestVisibilityProvider><MemoryRouter><SettingsPanel /></MemoryRouter></TestVisibilityProvider>)
    const group = await screen.findByRole('group', { name: 'Public gallery dates' })
    for (const day of ['21 August', '22 August']) {
      expect(within(group).getByRole('button', { name: day })).toBeDisabled()
      expect(within(group).getByRole('button', { name: day })).toHaveAttribute('aria-pressed', 'true')
    }
    fireEvent.click(within(group).getByRole('button', { name: 'Both days' }))
    await waitFor(() => expect(api.updateAdminSettings).toHaveBeenLastCalledWith({ visibility: { control: 'manual', mode: 'reception' } }))
    await waitFor(() => expect(within(group).getByRole('button', { name: '21 August' })).toBeEnabled())
    expect(within(group).getByRole('button', { name: '22 August' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('resumes the automatic schedule and refreshes shared public policy after saving', async () => {
    const visibility = resolveGalleryVisibility({ control: 'manual', mode: 'reception', lastSingleDay: 'reception', overrideUntil: null })
    const settings = { visibility, uploadsEnabled: true, autoApproveUploads: false, liveWallSource: 'all', events: [] }
    api.getAdminSettings.mockResolvedValue(settings)
    api.updateAdminSettings.mockResolvedValue({ ...settings, visibility: resolveGalleryVisibility(DEFAULT_GALLERY_VISIBILITY) })
    const refresh = vi.fn().mockResolvedValue({})
    render(<TestVisibilityProvider refresh={refresh}><MemoryRouter><SettingsPanel /></MemoryRouter></TestVisibilityProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Resume automatic schedule' }))
    await waitFor(() => expect(api.updateAdminSettings).toHaveBeenLastCalledWith({ visibility: { control: 'automatic' } }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  })
})
