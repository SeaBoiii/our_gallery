import { Camera, ImagePlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { copy } from '../i18n/copy'
import { useLocale } from '../context/useLocale'
import { LanguageToggle } from './LanguageToggle'
import { WeddingMonogram } from './WeddingMonogram'

export function FlightHeader({ onAddMemory }: { onAddMemory: () => void }) {
  const { locale } = useLocale()
  const t = copy[locale]
  const english = locale === 'en'
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand-lockup" to="/" aria-label={`Aleem & Nurulain — ${t.flightMemories}`}><WeddingMonogram compact /><span><strong>Aleem &amp; Nurulain</strong><small>{t.flightMemories}</small></span></Link>
        <nav className="header-actions" aria-label={t.primaryNavigation}>
          <Link className="header-link" to="/photobooth" aria-label={english ? 'Photo booth' : 'Ruang foto'}><Camera size={18} aria-hidden="true" /><span>{english ? 'Photo booth' : 'Ruang foto'}</span></Link>
          <LanguageToggle />
          <button className="header-add" type="button" onClick={onAddMemory}><ImagePlus aria-hidden="true" size={17} /><span>{english ? 'Share photos' : 'Kongsi foto'}</span></button>
        </nav>
      </div>
    </header>
  )
}
