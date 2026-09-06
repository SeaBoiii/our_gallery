import { ImagePlus, Search, ScanFace } from 'lucide-react'
import { Link } from 'react-router-dom'
import { copy } from '../i18n/copy'
import { useLocale } from '../context/useLocale'
import { LanguageToggle } from './LanguageToggle'
import { WeddingMonogram } from './WeddingMonogram'

export function FlightHeader({ onAddMemory, uploadsEnabled = true }: { onAddMemory?: () => void; uploadsEnabled?: boolean }) {
  const { locale } = useLocale()
  const t = copy[locale]
  return (
    <header className="site-header">
      <Link className="brand-lockup" to="/" aria-label={`${t.brand} — ${t.flightMemories}`}>
        <WeddingMonogram compact />
        <span><strong>{t.brand}</strong><small>{t.flightMemories}</small></span>
      </Link>
      <nav className="header-actions" aria-label={t.primaryNavigation}>
        <Link className="header-link" to="/explore"><Search aria-hidden="true" size={16} /><span>{t.explore}</span></Link>
        <Link className="header-link" to="/find-me"><ScanFace aria-hidden="true" size={16} /><span>{t.findMe}</span></Link>
        {uploadsEnabled && onAddMemory ? <button className="header-add" type="button" onClick={onAddMemory}>
          <ImagePlus aria-hidden="true" size={16} />
          <span>{t.addMemory}</span>
        </button> : null}
        <LanguageToggle />
      </nav>
    </header>
  )
}
