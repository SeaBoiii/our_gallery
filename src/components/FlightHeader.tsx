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
      <Link className="brand-lockup" to="/" aria-label={`Aleem & Nurulain — ${t.flightMemories}`}><WeddingMonogram compact /><span><strong>Aleem & Nurulain</strong><small>{locale === 'en' ? 'Our wedding collection' : 'Koleksi perkahwinan kami'}</small></span></Link>
      <div className="header-note">21 — 22 AUG 2027 <span>·</span> SINGAPORE</div>
      <nav className="header-actions" aria-label={t.primaryNavigation}><LanguageToggle /><button className="header-add" type="button" onClick={onAddMemory}><ImagePlus aria-hidden="true" size={16} /><span>{locale === 'en' ? 'Share a memory' : 'Kongsi kenangan'}</span></button></nav>
    </header>
  )
}
