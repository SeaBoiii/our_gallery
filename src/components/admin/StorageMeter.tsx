import type { AdminStats } from '../../../shared/contracts'
import { formatBytes } from '../../utils/files'

export function StorageMeter({ storage }: { storage: AdminStats['storage'] }) {
  const percentage = Math.min(100, (storage.totalBytes / storage.referenceTargetBytes) * 100)
  const segments = [
    ['Originals', storage.originalBytes],
    ['Gallery', storage.displayBytes],
    ['Thumbnails', storage.thumbnailBytes],
  ] as const
  return (
    <section className="storage-card">
      <div className="storage-heading"><div><p className="eyebrow">R2 storage</p><h2>Storage used</h2></div><p><strong>{formatBytes(storage.totalBytes)}</strong><span>/ {formatBytes(storage.referenceTargetBytes)} reference</span></p></div>
      <div className="storage-track" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={storage.referenceTargetBytes} aria-valuenow={storage.totalBytes}><span style={{ width: `${percentage}%` }} /></div>
      <p className="storage-note">The 500 GB reference is budgetary, not a hard limit. Warning begins at {formatBytes(storage.softWarningBytes)}.</p>
      <dl>{segments.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatBytes(value)}</dd></div>)}<div><dt>Photos</dt><dd>{formatBytes(storage.photoBytes)}</dd></div><div><dt>Videos</dt><dd>{formatBytes(storage.videoBytes)}</dd></div></dl>
    </section>
  )
}
