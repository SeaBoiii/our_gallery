import { ArrowUpRight, ImagePlus, PenLine } from 'lucide-react'
import { useLocale } from '../context/useLocale'
import { copy } from '../i18n/copy'

type HeroProps = {
  onAddMemory: () => void
  onLeaveGreeting?: () => void
  onTakePhoto: () => void
  onChooseMedia: () => void
}
export function Hero({ onAddMemory, onLeaveGreeting, onTakePhoto }: HeroProps) {
  const { locale } = useLocale()
  const t = copy[locale]
  return (
    <section className="hero" id="top" aria-labelledby="welcome-title">
      <div className="hero-copy">
        <p className="eyebrow">{locale === 'en' ? 'A wedding journal · 21—22 August 2027' : 'Jurnal perkahwinan · 21—22 Ogos 2027'}</p>
        <h1 id="welcome-title">{locale === 'en' ? <>Our day,<br /><em>through your eyes.</em></> : <>Hari kami,<br /><em>melalui mata anda.</em></>}</h1>
        <p className="hero-intro">{t.intro}</p>
        <div className="hero-actions">
          <button type="button" className="button button-primary" onClick={onAddMemory}><ImagePlus size={17} aria-hidden="true" />{locale === 'en' ? 'Share photos & videos' : 'Kongsi foto & video'}</button>
          <button type="button" className="button button-secondary" onClick={onLeaveGreeting}><PenLine size={17} aria-hidden="true" />{locale === 'en' ? 'Leave a greeting' : 'Tulis ucapan'}</button>
        </div>
        <div className="hero-footnote"><span>{locale === 'en' ? 'No account needed. Just a little love.' : 'Tanpa akaun. Cukup dengan kasih sayang.'}</span><button type="button" onClick={onTakePhoto}>{t.takePhoto}<ArrowUpRight size={13} aria-hidden="true" /></button></div>
      </div>
      <figure className="journal-cover">
        <picture><source srcSet="/journal-sky.avif" type="image/avif" /><img src="/journal-sky.webp" alt="" width="1440" height="960" fetchPriority="high" /></picture>
        <div className="journal-cover-shade" />
        <div className="journal-cover-top"><span>{locale === 'en' ? 'THE WEDDING COLLECTION' : 'KOLEKSI PERKAHWINAN'}</span><span>01 / 02</span></div>
        <figcaption><span>{locale === 'en' ? 'A journey to remember' : 'Perjalanan untuk dikenang'}</span><strong>Aleem <i>&</i><br />Nurulain</strong><small>21 — 22 . 08 . 2027</small></figcaption>
        <div className="journal-cover-bottom"><span>AN</span><span>{locale === 'en' ? 'Together, always.' : 'Bersama, selamanya.'}</span><ArrowUpRight size={19} aria-hidden="true" /></div>
      </figure>
    </section>
  )
}
