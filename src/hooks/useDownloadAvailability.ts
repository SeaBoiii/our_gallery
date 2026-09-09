import { useCallback, useEffect, useRef, useState } from 'react'
import type { GalleryDownloadStatus } from '../../shared/contracts'
import { getGalleryDownloadStatus } from '../services/api'

const STATUS_RETRY_DELAY_MS = 60_000
const MAX_RELEASE_TIMER_MS = 60 * 60 * 1_000

export function useDownloadAvailability() {
  const [status, setStatus] = useState<GalleryDownloadStatus | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const requestInFlight = useRef<Promise<void> | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(() => {
    if (requestInFlight.current) return requestInFlight.current

    const request = Promise.resolve()
      .then(() => getGalleryDownloadStatus())
      .then((nextStatus) => {
        if (mounted.current) setStatus(nextStatus)
      })
      .catch(() => {
        // A transient status failure must not revoke a release already confirmed
        // by the server. Before confirmation, the UI safely remains locked.
        if (mounted.current) setRefreshVersion((current) => current + 1)
      })
      .finally(() => {
        requestInFlight.current = null
      })

    requestInFlight.current = request
    return request
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false }
  }, [refresh])

  useEffect(() => {
    if (status?.available) return

    const releaseTime = status ? Date.parse(status.availableAt) : Number.NaN
    const serverTime = status ? Date.parse(status.serverTime) : Number.NaN
    const untilRelease = releaseTime - serverTime
    const delay = Number.isFinite(untilRelease) && untilRelease > 0
      ? Math.min(Math.max(untilRelease + 250, 1_000), MAX_RELEASE_TIMER_MS)
      : STATUS_RETRY_DELAY_MS
    const timer = window.setTimeout(() => void refresh(), delay)
    return () => window.clearTimeout(timer)
  }, [refresh, refreshVersion, status])

  useEffect(() => {
    const checkWhenActive = () => void refresh()
    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', checkWhenActive)
    document.addEventListener('visibilitychange', checkWhenVisible)
    return () => {
      window.removeEventListener('focus', checkWhenActive)
      document.removeEventListener('visibilitychange', checkWhenVisible)
    }
  }, [refresh])

  const markDownloadsLocked = useCallback(() => {
    setStatus((current) => current ? { ...current, available: false } : current)
  }, [])

  return {
    downloadsAvailable: status?.available === true,
    availableAt: status?.availableAt ?? null,
    refresh,
    markDownloadsLocked,
  }
}
