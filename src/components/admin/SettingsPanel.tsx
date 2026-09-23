import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { GallerySettings } from '../../../shared/contracts'
import { getAdminSettings, updateAdminSettings } from '../../services/api'
import { useGalleryVisibility } from '../../context/useGalleryVisibility'
import { automaticGalleryMode } from '../../../shared/visibility'

function Toggle({ checked, label, description, disabled, onChange }: { checked: boolean; label: string; description: string; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

export function SettingsPanel() {
  const { refresh } = useGalleryVisibility()
  const [settings, setSettings] = useState<GallerySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const savingLock = useRef(false)
  const sequence = useRef(0)
  const load = useCallback(async () => {
    if (savingLock.current) return
    const current = ++sequence.current
    try { const next = await getAdminSettings(); if (current === sequence.current) setSettings(next) }
    catch { if (current === sequence.current) setMessage('Settings could not be loaded.') }
  }, [])
  useEffect(() => {
    // Load external admin settings; the state update follows the API response.
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => { sequence.current += 1; window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [load])
  useEffect(() => {
    const visibility = settings?.visibility
    if (!visibility?.nextTransitionAt) return
    const delay = Date.parse(visibility.nextTransitionAt) - Date.parse(visibility.serverTime)
    if (!(delay > 0)) return
    const timer = window.setTimeout(() => void load(), Math.min(delay + 25, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [settings?.visibility, load])
  const save = async (payload: Parameters<typeof updateAdminSettings>[0]) => {
    if (!settings || savingLock.current) return
    savingLock.current = true
    const current = ++sequence.current
    setSaving(true); setMessage(null)
    try {
      const next = await updateAdminSettings(payload)
      if (current !== sequence.current) return
      setSettings(next); setMessage('Settings saved.')
      await refresh().catch(() => undefined)
    }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Settings could not be saved.') }
    finally { savingLock.current = false; setSaving(false) }
  }
  if (!settings) return <div className="admin-state">{saving ? <LoaderCircle className="spin" /> : message || 'Loading settings…'}</div>
  const visibility = settings.visibility
  const both = visibility.effectiveMode === 'both'
  const calendarMode = automaticGalleryMode(Date.parse(visibility.serverTime))
  const restoreDay = visibility.lastSingleDay ?? (calendarMode === 'both' ? 'reception' : calendarMode)
  const formatTime = (value: string) => new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }).format(new Date(value))
  return (
    <div className="settings-panel">
      <div className="admin-section-heading"><div><p className="eyebrow">Controls</p><h1>Gallery settings.</h1></div><p>Changes apply immediately. Closing uploads keeps existing approved memories visible.</p></div>
      <section className="settings-card"><p className="settings-card-label">Public gallery dates</p><h2>Our Wedding</h2><p>This controls the gallery, uploads, photo booth, live wall and QR card for every guest. Admin moderation always includes both dates.</p><div className="live-source-options" role="group" aria-label="Public gallery dates">{([['solemnisation', '21 August'], ['reception', '22 August']] as const).map(([mode, label]) => <button key={mode} type="button" aria-label={label} aria-pressed={both || visibility.effectiveMode === mode} disabled={saving || both} onClick={() => void save({ visibility: { control: 'manual', mode } })}>{label}{both ? ' · Included' : ''}</button>)}<button type="button" aria-pressed={both} disabled={saving} onClick={() => void save({ visibility: { control: 'manual', mode: both ? restoreDay : 'both' } })}>Both days</button></div><p className="settings-visibility-note">{both ? 'Both dates are included. Turn off Both days before choosing an individual date.' : `Guests see ${visibility.effectiveMode === 'solemnisation' ? '21' : '22'} August 2027.`}</p><p>{visibility.control === 'automatic' ? 'Automatic · switches at midnight on 22 and 23 August in Singapore.' : visibility.overrideUntil ? `Manual override until ${formatTime(visibility.overrideUntil)} (Singapore time).` : 'Manual override · stays active until you change it.'}</p><button className="button button-secondary" type="button" disabled={saving || visibility.control === 'automatic'} onClick={() => void save({ visibility: { control: 'automatic' } })}>Resume automatic schedule</button></section>
      <section className="settings-card"><p className="settings-card-label">Upload controls</p><Toggle checked={settings.uploadsEnabled} disabled={saving} label="Guest uploads" description="Allow guests to share new photos and videos for the visible dates." onChange={(uploadsEnabled) => void save({ uploadsEnabled })} /><Toggle checked={settings.autoApproveUploads} disabled={saving} label="Auto-approve uploads" description="When off, new memories wait in moderation before becoming public." onChange={(autoApproveUploads) => void save({ autoApproveUploads })} /></section>
      <section className="settings-card"><p className="settings-card-label">Live wall source</p><div className="live-source-options">{([['all','All visible memories'],['solemnisation','21 August'],['reception','22 August']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={settings.liveWallSource === value} disabled={saving} onClick={() => void save({ liveWallSource: value })}>{label}</button>)}</div><p>The live wall only shows dates included in the public gallery.</p><Link className="settings-link" to="/live" target="_blank">Open live wall <ExternalLink aria-hidden="true" /></Link></section>
      <section className="settings-card"><p className="settings-card-label">Venue QR</p><h2>A little invitation to share</h2><p>Print a QR card for tables, the welcome desk, and the projector station.</p><Link className="button button-secondary" to="/qr" target="_blank">Open printable QR <ExternalLink aria-hidden="true" /></Link></section>
      {message ? <p className="settings-message" role="status">{message}</p> : null}{saving ? <p className="settings-saving"><LoaderCircle className="spin" />Saving…</p> : null}
    </div>
  )
}
