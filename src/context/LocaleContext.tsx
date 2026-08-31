import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Locale } from '../i18n/copy'
import { LocaleContext } from './locale-context'

function initialLocale(): Locale {
  const saved = window.localStorage.getItem('an-gallery-locale')
  return saved === 'ms' ? 'ms' : 'en'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(initialLocale)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = (next: Locale) => {
    updateLocale(next)
    window.localStorage.setItem('an-gallery-locale', next)
    document.documentElement.lang = next
  }

  const value = useMemo(
    () => ({ locale, setLocale, toggleLocale: () => setLocale(locale === 'en' ? 'ms' : 'en') }),
    [locale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}
