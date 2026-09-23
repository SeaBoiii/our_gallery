import { useEffect, useState } from 'react'
import { CheckCircle2, CircleX, Clock3, HardDrive, Image, LoaderCircle, TriangleAlert, Video } from 'lucide-react'
import type { AdminStats } from '../../../shared/contracts'
import { getAdminStats } from '../../services/api'
import { StorageMeter } from './StorageMeter'

export function AdminOverview() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void getAdminStats().then(setStats).catch((reason) => setError(reason instanceof Error ? reason.message : 'Stats could not be loaded.')) }, [])
  if (error) return <div className="admin-state" role="alert">{error}</div>
  if (!stats) return <div className="admin-state"><LoaderCircle className="spin" aria-hidden="true" />Loading dashboard…</div>
  const cards = [
    ['Total uploads', stats.totalUploads, HardDrive],
    ['Photos', stats.totalPhotos, Image],
    ['Videos', stats.totalVideos, Video],
    ['Pending review', stats.pending, Clock3],
    ['Approved', stats.approved, CheckCircle2],
    ['Rejected', stats.rejected, CircleX],
    ['Derivative issues', stats.derivativeFailures, TriangleAlert],
  ] as const
  return (
    <div className="admin-overview">
      <div className="admin-section-heading"><div><p className="eyebrow">Gallery overview</p><h1>Every memory, together.</h1></div><p>{stats.uploadsToday} new memories today · {stats.dayOne} from 21 August · {stats.dayTwo} from 22 August</p></div>
      <div className="stats-grid">{cards.map(([label, value, Icon]) => <article key={label}><Icon aria-hidden="true" /><span>{label}</span><strong>{value.toLocaleString()}</strong></article>)}</div>
      <StorageMeter storage={stats.storage} />
    </div>
  )
}
