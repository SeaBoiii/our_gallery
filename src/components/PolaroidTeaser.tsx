import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLocale } from '../context/useLocale'
import '../styles/polaroid-teaser.css'

export function PolaroidTeaser() {
  const { locale } = useLocale()
  const english = locale === 'en'
  return <section className="polaroid-teaser" aria-labelledby="polaroid-teaser-title">
    <div className="polaroid-teaser-art" aria-hidden="true"><img src="/journal-sky.webp" alt="" width="88" height="101" /><span>Aleem & Nurulain</span></div>
    <div className="polaroid-teaser-copy"><p className="eyebrow">{english ? 'The wedding photo booth' : 'Ruang foto perkahwinan'}</p><h2 id="polaroid-teaser-title">{english ? 'A little moment. Yours to keep.' : 'Detik kecil untuk dikenang.'}</h2><p>{english ? 'Turn your photo into a Polaroid, wrapped in a little of our wedding story.' : 'Cipta Polaroid anda, dihiasi sentuhan kisah perkahwinan kami.'}</p></div>
    <Link to="/polaroid">{english ? 'Make a Polaroid' : 'Cipta Polaroid'}<ArrowUpRight size={16} aria-hidden="true" /></Link>
  </section>
}
