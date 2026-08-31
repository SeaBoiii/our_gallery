export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://gallery-api.aleemxnurul.love').replace(/\/$/, '')
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
export const USE_MOCK_DATA = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_DATA !== 'false'

export const MAX_IMAGE_SIZE = 25 * 1024 * 1024
export const MAX_VIDEO_SIZE = 250 * 1024 * 1024
export const MAX_FILES_PER_BATCH = 20
export const UPLOAD_CONCURRENCY = 3
export const GALLERY_PAGE_SIZE = 30
export const PUBLIC_GALLERY_URL = 'https://gallery.aleemxnurul.love'
