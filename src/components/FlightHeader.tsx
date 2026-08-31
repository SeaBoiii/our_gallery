import { ImagePlus } from 'lucide-react'
import { copy } from '../i18n/copy'
import { useLocale } from '../context/useLocale'
import { LanguageToggle } from './LanguageToggle'
import { WeddingMonogram } from './WeddingMonogram'

export function FlightHeader({ onAddMemory }: { onAddMemory: () => void }) {
  const { locale } = useLocale()
  const t = copy[locale]
  return (
    <header className="site-header">
      <a className="brand-lockup" href="#top" aria-label={`${t.brand} — ${t.flightMemories}`}>
        <WeddingMonogram compact />
        <span><strong>{t.brand}</strong><small>{t.flightMemories}</small></span>
      </a>
      <nav className="header-actions" aria-label={t.primaryNavigation}>
        <button className="header-add" type="button" onClick={onAddMemory}>
          <ImagePlus aria-hidden="true" size={16} />
          <span>{t.addMemory}</span>
        </button>
        <LanguageToggle />
      </nav>
    </header>
  )
}
