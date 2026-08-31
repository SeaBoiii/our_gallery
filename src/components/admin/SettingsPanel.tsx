import { useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { GallerySettings } from '../../../shared/contracts'
import { getAdminSettings, updateAdminSettings } from '../../services/api'

function Toggle({ checked, label, description, onChange }: { checked: boolean; label: string; description: string; onChange: (checked: boolean) => void }) {
  return <label className="setting-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<GallerySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { void getAdminSettings().then(setSettings).catch(() => setMessage('Settings could not be loaded.')) }, [])
  const save = async (payload: Parameters<typeof updateAdminSettings>[0]) => {
    if (!settings) return
    setSaving(true); setMessage(null)
    try { setSettings(await updateAdminSettings(payload)); setMessage('Settings saved.') }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Settings could not be saved.') }
    finally { setSaving(false) }
  }
  if (!settings) return <div className="admin-state">{saving ? <LoaderCircle className="spin" /> : message || 'Loading settings…'}</div>
  return (
    <div className="settings-panel">
      <div className="admin-section-heading"><div><p className="eyebrow">Controls</p><h1>Gallery settings.</h1></div><p>Changes apply immediately. Upload controls do not affect already checked-in memories.</p></div>
      <section className="settings-card"><p className="settings-card-label">Upload controls</p><Toggle checked={settings.uploadsEnabled} label="Guest uploads" description="Master switch for all new upload preparation." onChange={(uploadsEnabled) => void save({ uploadsEnabled })} /><Toggle checked={settings.autoApproveUploads} label="Auto-approve uploads" description="When off, new memories wait in moderation before becoming public." onChange={(autoApproveUploads) => void save({ autoApproveUploads })} />{settings.events.map((event) => <Toggle key={event.id} checked={event.uploadEnabled} label={event.displayName} description={`${event.eventDate} upload gate`} onChange={(uploadEnabled) => void save({ event: { slug: event.slug, uploadEnabled } })} />)}</section>
      <section className="settings-card"><p className="settings-card-label">Live wall source</p><div className="live-source-options">{([['all','Both celebrations'],['solemnisation','Day 1 only'],['reception','Day 2 only']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={settings.liveWallSource === value} onClick={() => void save({ liveWallSource: value })}>{label}</button>)}</div><Link className="settings-link" to="/live" target="_blank">Open live wall <ExternalLink aria-hidden="true" /></Link></section>
      <section className="settings-card"><p className="settings-card-label">Venue QR</p><h2>Printable boarding card</h2><p>Print a high-contrast QR card for tables, the welcome desk, and the projector station.</p><Link className="button button-secondary" to="/qr" target="_blank">Open printable QR <ExternalLink aria-hidden="true" /></Link></section>
      {message ? <p className="settings-message" role="status">{message}</p> : null}{saving ? <p className="settings-saving"><LoaderCircle className="spin" />Saving…</p> : null}
    </div>
  )
}
