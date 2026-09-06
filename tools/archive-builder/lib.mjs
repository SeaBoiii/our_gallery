import { createHash } from 'node:crypto'

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const CONTROL_AND_BIDI = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
const RESERVED_PATH = /[<>:"/\\|?*]/g

export function parseByteSize(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|KIB|MB|MIB|GB|GIB|TB|TIB)?$/i)
  if (!match) throw new Error(`Invalid byte size: ${value}`)
  const amount = Number(match[1])
  const unit = (match[2] || 'B').toUpperCase()
  const multiplier = { B:1, KB:1024, KIB:1024, MB:1024 ** 2, MIB:1024 ** 2, GB:1024 ** 3, GIB:1024 ** 3, TB:1024 ** 4, TIB:1024 ** 4 }[unit]
  const bytes = Math.floor(amount * multiplier)
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error(`Invalid byte size: ${value}`)
  return bytes
}

function truncatePreservingExtension(value, maxBytes = 180) {
  if (Buffer.byteLength(value,'utf8') <= maxBytes) return value
  const dot = value.lastIndexOf('.')
  const extension = dot > 0 && value.length - dot <= 16 && Buffer.byteLength(value.slice(dot),'utf8') <= 48 ? value.slice(dot) : ''
  const available = Math.max(1,maxBytes - Buffer.byteLength(extension,'utf8'))
  const characters = Array.from(extension ? value.slice(0,dot) : value)
  while (characters.length && Buffer.byteLength(characters.join(''),'utf8') > available) characters.pop()
  return `${characters.join('') || 'm'}${extension}`
}

export function sanitizeFilename(value) {
  let safe = String(value || 'memory').normalize('NFKC')
    .replace(CONTROL_AND_BIDI, '')
    .replace(RESERVED_PATH, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!safe || safe === '.' || safe === '..') safe = 'memory'
  if (WINDOWS_RESERVED.test(safe)) safe = `_${safe}`
  return truncatePreservingExtension(safe)
}

function monthName(month) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1] || 'Event'
}

export function eventFolder(item) {
  const [year,month,day] = String(item.eventDate).split('-').map(Number)
  const date = year && month && day ? `${String(day).padStart(2,'0')}-${monthName(month)}` : 'Wedding'
  return `${date}-${sanitizeFilename(item.eventDisplayName).replace(/\s+/g, '-')}`
}

export function assignArchiveNames(items) {
  return [...items]
    .sort((left,right) => left.eventDate.localeCompare(right.eventDate) || left.eventSequence - right.eventSequence || left.mediaId.localeCompare(right.mediaId))
    .map((item) => {
      const sequence = String(item.eventSequence).padStart(6, '0')
      const originalName = `${sequence}_${sanitizeFilename(item.originalFilename)}`
      const folder = eventFolder(item)
      const metadataBase = originalName.replace(/\.[^.]+$/, '')
      return {
        ...item,
        archiveFilename: `${folder}/originals/${originalName}`,
        metadataFilename: `${folder}/metadata/${metadataBase}.json`,
      }
    })
}

export function planShards(items, targetBytes, overheadPerItem = 4_096, maxFilesPerPart = 10_000, namesAssigned = false) {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 1) throw new Error('targetBytes must be a positive integer')
  if (!Number.isSafeInteger(maxFilesPerPart) || maxFilesPerPart < 1) throw new Error('maxFilesPerPart must be a positive integer')
  const byEvent = new Map()
  const namedItems = namesAssigned ? items : assignArchiveNames(items)
  for (const item of namedItems) {
    const list = byEvent.get(item.eventId) || []
    list.push(item)
    byEvent.set(item.eventId, list)
  }
  const plans = []
  for (const eventItems of byEvent.values()) {
    let current = []
    let estimatedBytes = 0
    let partNumber = 1
    for (const item of eventItems) {
      const itemBytes = Number(item.sizeBytes) + overheadPerItem
      if (current.length && (estimatedBytes + itemBytes > targetBytes || current.length >= maxFilesPerPart)) {
        plans.push({ eventId: current[0].eventId, eventSlug: current[0].eventSlug, eventDisplayName: current[0].eventDisplayName, partNumber, estimatedBytes, items: current })
        partNumber += 1
        current = []
        estimatedBytes = 0
      }
      current.push(item)
      estimatedBytes += itemBytes
    }
    if (current.length) plans.push({ eventId: current[0].eventId, eventSlug: current[0].eventSlug, eventDisplayName: current[0].eventDisplayName, partNumber, estimatedBytes, items: current })
  }
  return plans
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function partPlanSha256(plan) {
  const canonical = plan.items.map((item) => [item.mediaId,item.originalObjectKey,item.sizeBytes,item.archiveFilename,item.metadataFilename,item.mimeType,item.uploadedAt,item.guestName,item.guestMessage,item.categories,item.aiCaption,item.mediaType,item.width,item.height,item.durationSeconds,item.source,item.moderationStatus])
  return sha256Hex(JSON.stringify({ archiveFormatVersion:1,builderFormat:'zip64-store-fixed-date-v1',eventId:plan.eventId,partNumber:plan.partNumber,items:canonical }))
}

export function csvCell(value) {
  if (value === null || value === undefined) return ''
  let text = Array.isArray(value) ? value.join(' | ') : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const MANIFEST_COLUMNS = [
  'media_id','event_id','event','media_type','width','height','duration_seconds','source','moderation_status',
  'original_filename','archive_filename','mime_type','size_bytes','sha256','uploaded_at','guest_name','guest_message','categories','ai_caption',
]

export function manifestEntry(item) {
  return {
    media_id:item.mediaId,
    event_id:item.eventId,
    event:item.eventDisplayName,
    media_type:item.mediaType,
    width:item.width,
    height:item.height,
    duration_seconds:item.durationSeconds,
    source:item.source,
    moderation_status:item.moderationStatus,
    original_filename:item.originalFilename,
    archive_filename:item.archiveFilename,
    mime_type:item.mimeType,
    size_bytes:item.sizeBytes,
    sha256:item.sha256,
    uploaded_at:item.uploadedAt,
    guest_name:item.guestName,
    guest_message:item.guestMessage,
    categories:Array.isArray(item.categories) ? item.categories : [],
    ai_caption:item.aiCaption,
  }
}

export function manifestCsv(items) {
  const lines = [MANIFEST_COLUMNS.map(csvCell).join(',')]
  for (const item of items) {
    const entry = manifestEntry(item)
    lines.push(MANIFEST_COLUMNS.map((column) => csvCell(entry[column])).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

export function checksumsFile(items, parts = []) {
  const lines = []
  for (const item of items) {
    if (!/^[a-f0-9]{64}$/i.test(item.sha256 || '')) throw new Error(`Missing checksum for ${item.mediaId}`)
    lines.push(`${item.sha256.toLowerCase()}  ${item.archiveFilename}`)
  }
  for (const part of parts) lines.push(`${part.sha256.toLowerCase()}  parts/${part.eventId}/${part.filename}`)
  return `${lines.join('\n')}\n`
}

export function partFilename(plan) {
  const event = sanitizeFilename(plan.eventDisplayName).replace(/\s+/g, '-')
  return `AN-Wedding-${event}-Part${String(plan.partNumber).padStart(3,'0')}.zip`
}
