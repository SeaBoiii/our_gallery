import { useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { GallerySettings } from '../../../shared/contracts'
import { getAdminSettings, updateAdminSettings } from '../../services/api'

function Toggle({ checked, label, description, disabled, onChange }: { checked: boolean; label: string; description: string; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<GallerySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const savingLock = useRef(false)
  useEffect(() => { void getAdminSettings().then(setSettings).catch(() => setMessage('Settings could not be loaded.')) }, [])
  const save = async (payload: Parameters<typeof updateAdminSettings>[0]) => {
    if (!settings || savingLock.current) return
    savingLock.current = true
    setSaving(true); setMessage(null)
    try { setSettings(await updateAdminSettings(payload)); setMessage('Settings saved.') }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Settings could not be saved.') }
    finally { savingLock.current = false; setSaving(false) }
  }
  if (!settings) return <div className="admin-state">{saving ? <LoaderCircle className="spin" /> : message || 'Loading settings…'}</div>
  return (
    <div className="settings-panel">
      <div className="admin-section-heading"><div><p className="eyebrow">Controls</p><h1>Gallery settings.</h1></div><p>Changes apply immediately. Closing uploads or greetings keeps existing approved memories and wishes visible.</p></div>
      <section className="settings-card"><p className="settings-card-label">Guestbook</p><Toggle checked={settings.greetingsEnabled !== false} disabled={saving} label="Guest greetings" description="Allow written wishes for both celebrations. Every greeting requires approval, independently of upload settings." onChange={(greetingsEnabled) => void save({ greetingsEnabled })} /></section>
      <section className="settings-card"><p className="settings-card-label">Upload controls</p><Toggle checked={settings.uploadsEnabled} disabled={saving} label="Guest uploads" description="Allow guests to share new photos and videos." onChange={(uploadsEnabled) => void save({ uploadsEnabled })} /><Toggle checked={settings.autoApproveUploads} disabled={saving} label="Auto-approve uploads" description="When off, new memories wait in moderation before becoming public. This does not apply to greetings." onChange={(autoApproveUploads) => void save({ autoApproveUploads })} />{settings.events.map((event) => <Toggle key={event.id} checked={event.uploadEnabled} disabled={saving} label={event.displayName} description={`${event.eventDate} uploads`} onChange={(uploadEnabled) => void save({ event: { slug: event.slug, uploadEnabled } })} />)}</section>
      <section className="settings-card"><p className="settings-card-label">Live wall source</p><div className="live-source-options">{([['all','Both celebrations'],['solemnisation','Solemnisation only'],['reception',"Groom’s reception only"]] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={settings.liveWallSource === value} disabled={saving} onClick={() => void save({ liveWallSource: value })}>{label}</button>)}</div><Link className="settings-link" to="/live" target="_blank">Open live wall <ExternalLink aria-hidden="true" /></Link></section>
      <section className="settings-card"><p className="settings-card-label">Venue QR</p><h2>A little invitation to share</h2><p>Print a QR card for tables, the welcome desk, and the projector station.</p><Link className="button button-secondary" to="/qr" target="_blank">Open printable QR <ExternalLink aria-hidden="true" /></Link></section>
      {message ? <p className="settings-message" role="status">{message}</p> : null}{saving ? <p className="settings-saving"><LoaderCircle className="spin" />Saving…</p> : null}
    </div>
  )
}
