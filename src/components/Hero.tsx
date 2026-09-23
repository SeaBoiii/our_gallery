import { ArrowDown, Camera, ImagePlus, Plane } from 'lucide-react'
import { useLocale } from '../context/useLocale'
import { useGalleryVisibility } from '../context/useGalleryVisibility'
import { galleryDateLabel } from '../utils/date'
import { copy } from '../i18n/copy'
import { PaperPlane } from './PaperPlane'

type HeroProps = {
  onAddMemory: () => void
  onTakePhoto: () => void
  onChooseMedia: () => void
}

export function Hero({ onAddMemory, onTakePhoto, onChooseMedia }: HeroProps) {
  const { locale } = useLocale()
  const { config } = useGalleryVisibility()
  const date = galleryDateLabel(config?.mode ?? null, locale)
  const t = copy[locale]
  const english = locale === 'en'
  return (
    <section className="hero" id="top" aria-labelledby="welcome-title">
      <picture className="hero-sky"><source srcSet="/journal-sky.avif" type="image/avif" /><img src="/journal-sky.webp" alt="" width="1440" height="960" fetchPriority="high" /></picture>
      <svg className="hero-flight-path" viewBox="0 0 1200 480" fill="none" aria-hidden="true"><path d="M-30 350C130 235 256 470 150 405S163 123 389 171 625 393 817 263 1008 92 1240 80" stroke="currentColor" strokeDasharray="3 7" /></svg>
      <span className="hero-margin-note" aria-hidden="true">AN / {date.toUpperCase()}</span>
      <div className="hero-plane"><PaperPlane /></div>
      <div className="hero-postmark" aria-hidden="true"><span>{english ? 'WITH LOVE' : 'DENGAN KASIH'}</span><b>A <i>&</i> N</b><span>SINGAPORE · 2027</span></div>
      <div className="hero-copy">
        <p className="eyebrow"><span />{english ? 'The wedding journal' : 'Jurnal perkahwinan'}<span /></p>
        <h1 id="welcome-title">{english ? <>Our journey,<br /><em>through your eyes.</em></> : <>Perjalanan kami,<br /><em>melalui mata anda.</em></>}</h1>
        <p className="hero-intro">{english ? 'The stolen glances. The happy tears. The moments only you could capture.' : 'Pandangan penuh kasih. Air mata gembira. Detik indah dari sudut pandangan anda.'}</p>
        <div className="hero-actions">
          <button type="button" className="button button-primary" onClick={onAddMemory}><ImagePlus size={17} aria-hidden="true" />{english ? 'Share a memory' : 'Kongsi kenangan'}</button>
          <a className="hero-gallery-link" href="#gallery">{english ? 'Explore the gallery' : 'Terokai galeri'}<ArrowDown size={15} aria-hidden="true" /></a>
        </div>
        <div className="hero-quick-actions" role="group" aria-label={t.quickActions}>
          <button type="button" onClick={onTakePhoto}><Camera size={14} aria-hidden="true" />{t.takePhoto}</button><span aria-hidden="true">/</span><button type="button" onClick={onChooseMedia}>{english ? 'Choose photos & videos' : 'Pilih foto & video'}</button>
        </div>
      </div>
      <div className="hero-itinerary">
        <div><span>{english ? 'The newlyweds' : 'Pengantin'}</span><strong>Aleem <i>&</i> Nurulain</strong></div>
        <div className="itinerary-route"><span>{english ? 'One beautiful beginning.' : 'Satu permulaan indah.'}</span><strong>{date}</strong></div>
        <div className="itinerary-destination"><span>{t.destination}</span><strong><Plane size={15} aria-hidden="true" />{t.destinationValue}</strong></div>
      </div>
    </section>
  )
}
