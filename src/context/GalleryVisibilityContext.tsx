import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PublicGalleryConfig } from '../../shared/contracts'
import { isGalleryDayMode, PUBLIC_CONFIG_MAX_AGE_MS, visibleEventSlugs } from '../../shared/visibility'
import { getGalleryConfig } from '../services/api'
import { GalleryVisibilityContext, type GalleryVisibilityContextValue } from './gallery-visibility-context'

export function GalleryVisibilityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Pick<GalleryVisibilityContextValue, 'config' | 'status'>>({ config: null, status: 'loading' })
  const mounted = useRef(false)
  const sequence = useRef(0)
  const expiryTimer = useRef<number | null>(null)
  const expiresAt = useRef(0)
  const refreshRef = useRef<() => Promise<PublicGalleryConfig>>(null)

  const refresh = useCallback(async (): Promise<PublicGalleryConfig> => {
    const request = ++sequence.current
    const started = performance.now()
    try {
      const config = await getGalleryConfig()
      if (!mounted.current || request !== sequence.current) throw new Error('A newer gallery configuration is being checked.')
      if (!config || !isGalleryDayMode(config.mode) || typeof config.uploadsEnabled !== 'boolean' || typeof config.revision !== 'string' || !Array.isArray(config.events)) throw new Error('The gallery configuration could not be confirmed.')
      const visible = visibleEventSlugs(config.mode)
      if (!config.events.every(event => event && visible.includes(event.slug)) || !visible.every(day => config.events.some(event => event.slug === day))) throw new Error('The gallery dates could not be confirmed.')
      const serverTime = Date.parse(config.serverTime)
      const validUntil = Date.parse(config.validUntil)
      const transition = config.nextTransitionAt ? Date.parse(config.nextTransitionAt) : Infinity
      // Use the server's clock and subtract the whole round trip conservatively.
      const remaining = Math.min(validUntil, transition, serverTime + PUBLIC_CONFIG_MAX_AGE_MS) - serverTime - (performance.now() - started)
      if (!Number.isFinite(serverTime) || !Number.isFinite(validUntil) || !(remaining > 0)) throw new Error('The gallery configuration has expired.')
      if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current)
      expiresAt.current = performance.now() + remaining
      const deadline = expiresAt.current
      setState({ config, status: 'ready' })
      expiryTimer.current = window.setTimeout(() => {
        if (!mounted.current || expiresAt.current !== deadline) return
        expiresAt.current = 0
        setState({ config: null, status: 'loading' })
        void refreshRef.current?.().catch(() => undefined)
      }, Math.min(remaining, 2_147_483_647))
      return config
    } catch (error) {
      if (mounted.current && request === sequence.current) {
        if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current)
        expiresAt.current = 0
        setState({ config: null, status: 'error' })
      }
      throw error
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    refreshRef.current = refresh
    // Initial synchronization with the server; state changes after its response.
    // eslint-disable-next-line react/set-state-in-effect
    void refresh().catch(() => undefined)
    // Refresh before the server's 30-second lease expires; the independent hard
    // expiry still removes private media if this request stalls or fails.
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 25_000)
    const onActive = () => {
      if (expiresAt.current <= performance.now()) setState({ config: null, status: 'loading' })
      void refresh().catch(() => undefined)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') onActive() }
    window.addEventListener('focus', onActive)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      mounted.current = false
      sequence.current += 1
      window.clearInterval(timer)
      if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current)
      window.removeEventListener('focus', onActive)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh])
  return <GalleryVisibilityContext.Provider value={value}>{children}</GalleryVisibilityContext.Provider>
}
