import { useEffect, useRef } from 'react'
import { TURNSTILE_SITE_KEY, USE_MOCK_DATA } from '../../config'
import { useLocale } from '../../context/useLocale'
import { copy } from '../../i18n/copy'

const SCRIPT_ID = 'turnstile-script'

export function TurnstileWidget({ onToken, onError }: { onToken: (token: string) => void; onError: (message: string) => void }) {
  const { locale } = useLocale()
  const t = copy[locale].upload
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<string | null>(null)

  useEffect(() => {
    if (USE_MOCK_DATA) { onToken('development-bypass'); return }
    if (!TURNSTILE_SITE_KEY) { onError(t.verificationMissing); return }

    const render = () => {
      if (!containerRef.current || !window.turnstile || widgetRef.current) return
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action: 'upload_prepare',
        theme: 'light',
        size: 'flexible',
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(''),
        'error-callback': () => onError(t.verificationFailed),
      })
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      if (window.turnstile) render()
      else existing.addEventListener('load', render, { once: true })
    } else {
      const script = document.createElement('script')
      script.id = SCRIPT_ID
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.onload = render
      script.onerror = () => onError(t.verificationOffline)
      document.head.append(script)
    }

    return () => {
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current)
      widgetRef.current = null
    }
  }, [onError, onToken, t.verificationFailed, t.verificationMissing, t.verificationOffline])

  return <div ref={containerRef} className="turnstile-slot" />
}
