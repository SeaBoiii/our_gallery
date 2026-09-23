import { useEffect, useRef } from 'react'
import { TURNSTILE_SITE_KEY, USE_MOCK_DATA } from '../../config'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'

const SCRIPT_ID = 'turnstile-script'
let scriptLoading: Promise<void> | null = null

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve()
  if (scriptLoading) return scriptLoading
  scriptLoading = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    const script = existing || document.createElement('script')
    const cleanup = () => {
      script.removeEventListener('load', loaded)
      script.removeEventListener('error', failed)
    }
    const failed = () => {
      cleanup()
      script.remove()
      scriptLoading = null
      reject(new Error('Verification could not load'))
    }
    const loaded = () => {
      if (!window.turnstile) { failed(); return }
      cleanup()
      scriptLoading = null
      resolve()
    }
    script.addEventListener('load', loaded, { once: true })
    script.addEventListener('error', failed, { once: true })
    if (!existing) {
      script.id = SCRIPT_ID
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      document.head.append(script)
    }
  })
  return scriptLoading
}

export function TurnstileWidget({ onToken, onError, action = 'upload_prepare', resetKey = 0 }: { onToken: (token: string) => void; onError: (message: string) => void; action?: 'upload_prepare' | 'greeting_submit'; resetKey?: number }) {
  const { locale } = useLocale()
  const t = copy[locale].upload
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    onToken('')
    if (USE_MOCK_DATA) { onToken('development-bypass'); return }
    if (!TURNSTILE_SITE_KEY) { onError(t.verificationMissing); return }
    void loadTurnstile().then(() => {
      if (!active || !containerRef.current || !window.turnstile) return
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action,
        theme: 'light',
        size: 'flexible',
        callback: (token: string) => { if (active) onToken(token) },
        'expired-callback': () => { if (active) onToken('') },
        'error-callback': () => { if (active) { onToken(''); onError(t.verificationFailed) } },
      })
    }).catch(() => { if (active) onError(t.verificationOffline) })
    return () => {
      active = false
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current)
      widgetRef.current = null
    }
  }, [action, resetKey, onError, onToken, t.verificationFailed, t.verificationMissing, t.verificationOffline])

  return <div ref={containerRef} className="turnstile-slot" />
}
