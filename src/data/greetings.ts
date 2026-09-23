import type { AdminGreeting, AdminGreetingPage, AdminGreetingStats, CreateGreetingReceipt, CreateGreetingRequest, GreetingPage, GreetingStatus } from '../../shared/contracts'

const STORAGE_KEY = 'an-gallery-development-greetings-v1'
type StoredGreeting = AdminGreeting & { requestId: string; fingerprint: string }
const initialGreetings: StoredGreeting[] = [
  { id: 'greeting-demo-1', guestName: 'Faris & Hana', message: 'May your home always be filled with laughter, your days with kindness, and your hearts with the love we see today. So happy for you both.', createdAt: '2027-08-22T12:00:00.000Z', status: 'approved', requestId: 'demo-1', fingerprint: '' },
  { id: 'greeting-demo-2', guestName: 'Aisyah', message: 'Semoga berbahagia hingga ke syurga. Wishing you both a beautiful life together, with a little adventure along the way.', createdAt: '2027-08-21T11:00:00.000Z', status: 'approved', requestId: 'demo-2', fingerprint: '' },
  { id: 'greeting-demo-3', guestName: 'The cousins', message: 'To the beginning of your favourite adventure. We love you both, and we are so glad we get to be a part of this day.', createdAt: '2027-08-21T10:00:00.000Z', status: 'approved', requestId: 'demo-3', fingerprint: '' },
]
let fallback: StoredGreeting[] | undefined

export class MockGreetingError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

function read(): StoredGreeting[] {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (Array.isArray(parsed)) return parsed as StoredGreeting[]
    }
  } catch { /* In-memory mode still works when browser storage is unavailable. */ }
  return fallback ?? initialGreetings.map((item) => ({ ...item }))
}

function write(items: StoredGreeting[]) {
  fallback = items
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch { /* Use in-memory state. */ }
}

function publicGreeting(item: StoredGreeting) {
  return { id: item.id, guestName: item.guestName, message: item.message, createdAt: item.createdAt }
}

function page(items: StoredGreeting[], cursor?: string, limit = 12) {
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const offset = cursor ? Math.max(0, sorted.findIndex((item) => item.id === cursor) + 1) : 0
  const chosen = sorted.slice(offset, offset + limit)
  return { items: chosen, nextCursor: offset + limit < sorted.length ? chosen.at(-1)!.id : null }
}

/** Called only behind the development-only USE_MOCK_DATA gate in the API service. */
export const developmentGreetings = {
  list(submissionsOpen: boolean, params: { cursor?: string; limit?: number } = {}): GreetingPage {
    const result = page(read().filter((item) => item.status === 'approved'), params.cursor, params.limit)
    return { ...result, items: result.items.map(publicGreeting), submissionsOpen }
  },
  submit(payload: CreateGreetingRequest, submissionsOpen: boolean): CreateGreetingReceipt {
    const guestName = payload.guestName?.trim() || null
    const message = payload.message.trim()
    if (!message || message.length > 1000 || (guestName?.length ?? 0) > 80) throw new MockGreetingError('INVALID_GREETING', 'Please check your greeting.')
    const fingerprint = JSON.stringify([guestName, message])
    const items = read()
    const existing = items.find((item) => item.requestId === payload.requestId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new MockGreetingError('REQUEST_ID_CONFLICT', 'This request has already been used.')
      return { id: existing.id, status: existing.status }
    }
    if (!submissionsOpen) throw new MockGreetingError('GREETINGS_CLOSED', 'The guestbook is closed to new greetings.')
    const item: StoredGreeting = { id: crypto.randomUUID(), requestId: payload.requestId, fingerprint, guestName, message, status: 'pending', createdAt: new Date().toISOString() }
    write([item, ...items])
    return { id: item.id, status: 'pending' }
  },
  adminList(params: { status?: GreetingStatus; cursor?: string; limit?: number } = {}): AdminGreetingPage {
    const result = page(read().filter((item) => item.status !== 'deleted' && (!params.status || item.status === params.status)), params.cursor, params.limit ?? 24)
    return { ...result, items: result.items.map((item) => ({ ...publicGreeting(item), status: item.status })) }
  },
  stats(): AdminGreetingStats {
    const items = read().filter((item) => item.status !== 'deleted')
    return { pending: items.filter((item) => item.status === 'pending').length, approved: items.filter((item) => item.status === 'approved').length, rejected: items.filter((item) => item.status === 'rejected').length, total: items.length }
  },
  update(ids: string[], status: 'approved' | 'rejected') {
    let updated = 0
    write(read().map((item) => {
      if (!ids.includes(item.id) || item.status === 'deleted') return item
      updated += 1
      return { ...item, status }
    }))
    return { updated }
  },
  delete(id: string) {
    write(read().map((item) => item.id === id ? { ...item, guestName: null, message: '', status: 'deleted' } : item))
    return { deleted: true }
  },
}
