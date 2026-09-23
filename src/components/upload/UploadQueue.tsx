import { FileImage, FileVideo, RotateCcw, Trash2 } from 'lucide-react'
import type { UploadQueueItem } from '../../types/upload'
import { formatBytes } from '../../utils/files'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'

export function UploadQueue({ items, canRemove, onRemove, onRetry }: { items: UploadQueueItem[]; canRemove: boolean; onRemove: (id: string) => void; onRetry?: (id: string) => void }) {
  const { locale } = useLocale()
  const t = copy[locale].upload

  return (
    <ul className="upload-queue" aria-label={t.selectedMemories}>
      {items.map((item) => (
        <li key={item.clientId} className={`queue-item queue-item--${item.state}`}>
          <span className="queue-preview">
            {item.previewUrl ? (item.mediaType === 'video' ? <video src={item.previewUrl} muted playsInline preload="metadata" aria-hidden="true" /> : <img src={item.previewUrl} alt="" />) : item.mediaType === 'photo' ? <FileImage aria-hidden="true" /> : <FileVideo aria-hidden="true" />}
          </span>
          <span className="queue-copy">
            <strong title={item.file.name}>{item.file.name}</strong>
            <small>{item.mediaType === 'photo' ? t.photo : t.video} · {formatBytes(item.file.size)}</small>
            {item.state !== 'queued' && item.state !== 'preparing' ? (
              <span className="file-progress"><span style={{ width: `${item.progress}%` }} /></span>
            ) : null}
            {item.error ? <span className="queue-error" role="alert">{item.error}</span> : null}
          </span>
          <span className="queue-state" aria-live="polite">{item.state === 'complete' ? t.checkedIn : item.state === 'failed' ? t.failed : item.state === 'preparing' ? t.preparing : item.state === 'completing' ? t.finishing : item.state === 'uploading' ? `${item.progress}%` : t.ready}</span>
          {canRemove && item.state !== 'complete' ? <button type="button" onClick={() => onRemove(item.clientId)} aria-label={`${t.removeFile} ${item.file.name}`}><Trash2 aria-hidden="true" size={16} /></button> : null}
          {!canRemove && item.state === 'failed' && onRetry ? <button type="button" onClick={() => onRetry(item.clientId)} aria-label={`${t.retryFile} ${item.file.name}`}><RotateCcw aria-hidden="true" size={16} /></button> : null}
        </li>
      ))}
    </ul>
  )
}
