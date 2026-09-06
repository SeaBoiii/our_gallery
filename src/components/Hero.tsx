import { ArrowDown, Camera, ImagePlus, Plane, Search, ScanFace } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLocale } from '../context/useLocale'
import { copy } from '../i18n/copy'
import { WeddingMonogram } from './WeddingMonogram'

type HeroProps = {
  onAddMemory: () => void
  onTakePhoto: () => void
  onChooseMedia: () => void
  uploadsEnabled?: boolean
}

export function Hero({ onAddMemory, onTakePhoto, onChooseMedia, uploadsEnabled = true }: HeroProps) {
  const { locale } = useLocale()
  const t = copy[locale]
  return (
    <section className="hero" id="top">
      <div className="hero-card">
        <div className="hero-stamp"><WeddingMonogram /></div>
        <p className="eyebrow">{t.eyebrow}</p>
        <p className="hero-brand">{t.brand}</p>
        <h1><span>{t.titleLineOne}</span><span>{t.titleLineTwo}</span></h1>
        <p className="hero-dates">{t.dates}</p>
        <p className="hero-intro">{t.intro}</p>

        <div className="hero-actions">
          {uploadsEnabled ? <button type="button" className="button button-primary" onClick={onAddMemory}>
            <ImagePlus aria-hidden="true" size={18} /> {t.addMemory}
          </button> : <Link className="button button-primary" to="/explore"><Search aria-hidden="true" size={18} />{t.explore}</Link>}
          {uploadsEnabled ? <div className="quick-actions" aria-label={t.quickActions}>
            <button type="button" onClick={onTakePhoto}><Camera aria-hidden="true" size={17} />{t.takePhoto}</button>
            <button type="button" onClick={onChooseMedia}><ImagePlus aria-hidden="true" size={17} />{t.chooseMedia}</button>
          </div> : <div className="quick-actions"><Link to="/find-me"><ScanFace aria-hidden="true" size={17} />{t.findMe}</Link></div>}
        </div>

        <dl className="flight-meta">
          <div><dt>{t.destination}</dt><dd>{t.destinationValue}</dd></div>
          <div><dt>{t.flight}</dt><dd>AN-210827</dd></div>
          <div><dt>{t.status}</dt><dd><span className="status-dot" />{t.statusValue}</dd></div>
        </dl>
        <Plane className="hero-plane" aria-hidden="true" size={18} />
      </div>
      <a className="scroll-cue" href="#gallery"><span>{t.viewGallery}</span><ArrowDown aria-hidden="true" size={15} /></a>
    </section>
  )
}
