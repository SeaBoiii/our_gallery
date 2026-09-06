import { useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { GallerySettings } from '../../../shared/contracts'
import { getAdminSettings, updateAdminSettings } from '../../services/api'

function Toggle({ checked, label, description, onChange, disabled = false }: { checked: boolean; label: string; description: string; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className="setting-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<GallerySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { void getAdminSettings().then(setSettings).catch(() => setMessage('Settings could not be loaded.')) }, [])
  const save = async (payload: Parameters<typeof updateAdminSettings>[0]) => {
    if (!settings || saving) return
    setSaving(true); setMessage(null)
    try { setSettings(await updateAdminSettings(payload)); setMessage('Settings saved.') }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Settings could not be saved.') }
    finally { setSaving(false) }
  }
  if (!settings) return <div className="admin-state">{saving ? <LoaderCircle className="spin" /> : message || 'Loading settings…'}</div>
  return (
    <div className="settings-panel">
      <div className="admin-section-heading"><div><p className="eyebrow">Controls</p><h1>Gallery settings.</h1></div><p>Changes apply immediately. Upload controls do not affect already checked-in memories.</p></div>
      <section className="settings-card"><p className="settings-card-label">Application mode</p><div className="live-source-options">{([['live','Live wedding'],['post-wedding','Post-wedding'],['archive','Archive']] as const).map(([value,label]) => <button key={value} type="button" disabled={saving} aria-pressed={settings.eventMode === value} onClick={() => void save({ eventMode: value })}>{label}</button>)}</div><p>Live keeps uploads and the wall active. Post-wedding keeps discovery available. Archive is read-only and disables Find Me.</p></section>
      <section className="settings-card"><p className="settings-card-label">Upload controls</p><Toggle disabled={saving} checked={settings.uploadsEnabled} label="Guest uploads" description="Master switch for all new upload preparation." onChange={(uploadsEnabled) => void save({ uploadsEnabled })} /><Toggle disabled={saving} checked={settings.autoApproveUploads} label="Auto-approve uploads" description="When off, new memories wait in moderation before becoming public." onChange={(autoApproveUploads) => void save({ autoApproveUploads })} />{settings.events.map((event) => <Toggle disabled={saving} key={event.id} checked={event.uploadEnabled} label={event.displayName} description={`${event.eventDate} upload gate`} onChange={(uploadEnabled) => void save({ event: { slug: event.slug, uploadEnabled } })} />)}</section>
      <section className="settings-card"><p className="settings-card-label">AI & discovery</p><Toggle disabled={saving} checked={settings.aiEnabled} label="AI processing" description="Master switch for background captions, categories, semantic search, and face indexing." onChange={(aiEnabled) => void save({ aiEnabled })} /><Toggle disabled={saving} checked={settings.autoAiProcessing} label="Automatic processing" description="Queue newly eligible approved media automatically." onChange={(autoAiProcessing) => void save({ autoAiProcessing })} /><Toggle disabled={saving} checked={settings.semanticSearchEnabled} label="Natural-language search" description="Allow guests to search AI-derived captions and categories." onChange={(semanticSearchEnabled) => void save({ semanticSearchEnabled })} /><Toggle disabled={saving} checked={settings.faceSearchEnabled} label="Find Me" description="Use the configured calibrated provider for consented selfie similarity searches." onChange={(faceSearchEnabled) => void save({ faceSearchEnabled })} /><Toggle disabled={saving} checked={settings.aiProcessingPaused} label="Pause background AI" description="Leave queued jobs durable without starting new analysis." onChange={(aiProcessingPaused) => void save({ aiProcessingPaused })} /></section>
      <section className="settings-card"><p className="settings-card-label">Live wall source</p><div className="live-source-options">{([['all','Both celebrations'],['solemnisation','Day 1 only'],['reception','Day 2 only']] as const).map(([value,label]) => <button disabled={saving} key={value} type="button" aria-pressed={settings.liveWallSource === value} onClick={() => void save({ liveWallSource: value })}>{label}</button>)}</div><Link className="settings-link" to="/live" target="_blank">Open live wall <ExternalLink aria-hidden="true" /></Link></section>
      <section className="settings-card"><p className="settings-card-label">Venue QR</p><h2>Printable boarding card</h2><p>Print a high-contrast QR card for tables, the welcome desk, and the projector station.</p><Link className="button button-secondary" to="/qr" target="_blank">Open printable QR <ExternalLink aria-hidden="true" /></Link></section>
      {message ? <p className="settings-message" role="status">{message}</p> : null}{saving ? <p className="settings-saving"><LoaderCircle className="spin" />Saving…</p> : null}
    </div>
  )
}
