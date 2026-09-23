import { ArrowUpRight, Plane } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLocale } from '../context/useLocale'
import '../styles/polaroid-teaser.css'

export function PolaroidTeaser() {
  const { locale } = useLocale()
  const english = locale === 'en'
  return <section className="polaroid-teaser" aria-labelledby="photobooth-teaser-title">
    <div className="polaroid-teaser-art" aria-hidden="true">
      <div className="photobooth-teaser-strip">
        <div className="photobooth-teaser-shots">{[0, 1, 2, 3].map((shot) => <span key={shot} className={`photobooth-teaser-shot photobooth-teaser-shot--${shot + 1}`}><img src="/journal-sky.webp" alt="" width="1440" height="960" loading="lazy" decoding="async" /></span>)}</div>
        <span className="photobooth-teaser-signature">Aleem & Nurulain</span>
      </div>
      <Plane className="photobooth-teaser-plane" size={20} />
    </div>
    <div className="polaroid-teaser-copy"><p className="eyebrow">{english ? 'The wedding photo booth' : 'Ruang foto perkahwinan'}</p><h2 id="photobooth-teaser-title">{english ? 'Four photos. One little keepsake.' : 'Empat foto. Satu kenangan istimewa.'}</h2><p>{english ? 'Step into the booth for four photos, then keep them as a classic strip or a four-frame grid.' : 'Ambil empat foto, kemudian simpan sebagai jalur foto klasik atau susun atur empat bingkai.'}</p></div>
    <Link to="/photobooth">{english ? 'Enter photo booth' : 'Masuk ruang foto'}<ArrowUpRight size={16} aria-hidden="true" /></Link>
  </section>
}
