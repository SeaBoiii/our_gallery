import { ImagePlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { copy } from '../i18n/copy'
import { useLocale } from '../context/useLocale'
import { LanguageToggle } from './LanguageToggle'
import { WeddingMonogram } from './WeddingMonogram'

export function FlightHeader({ onAddMemory }: { onAddMemory: () => void }) {
  const { locale } = useLocale()
  const t = copy[locale]
  return (
    <header className="site-header">
      <Link className="brand-lockup" to="/" aria-label={`Aleem & Nurulain — ${t.flightMemories}`}><WeddingMonogram compact /><span><strong>Aleem & Nurulain</strong><small>{locale === 'en' ? 'A wedding to remember' : 'Perkahwinan untuk dikenang'}</small></span></Link>
      <nav className="header-actions" aria-label={t.primaryNavigation}><Link className="header-gallery" to="/photobooth">{locale === 'en' ? 'Enter photo booth' : 'Masuk ruang foto'}</Link><LanguageToggle /><button className="header-add" type="button" aria-label={locale === 'en' ? 'Share a memory' : 'Kongsi kenangan'} onClick={onAddMemory}><ImagePlus aria-hidden="true" size={16} /><span>{locale === 'en' ? 'Share a memory' : 'Kongsi kenangan'}</span></button></nav>
    </header>
  )
}
