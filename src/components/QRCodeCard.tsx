import { QRCodeSVG } from 'qrcode.react'
import { Plane } from 'lucide-react'
import { PUBLIC_GALLERY_URL } from '../config'
import { WeddingMonogram } from './WeddingMonogram'
import { useLocale } from '../context/useLocale'
import { copy } from '../i18n/copy'

export function QRCodeCard({ compact = false }: { compact?: boolean }) {
  const { locale } = useLocale()
  const t = copy[locale].qr
  return (
    <section className={`qr-card${compact ? ' qr-card--compact' : ''}`} aria-label={t.aria}>
      <div className="qr-card-brand"><WeddingMonogram compact={compact} /><span><strong>Aleem & Nurul</strong><small>{copy[locale].flightMemories}</small></span></div>
      <div className="qr-code-frame">
        <QRCodeSVG value={PUBLIC_GALLERY_URL} size={compact ? 150 : 250} level="H" marginSize={1} bgColor="#fffefa" fgColor="#173c44" title={t.scanTitle} />
      </div>
      <p className="eyebrow">{t.scan}</p>
      <h2>{t.headingOne}<br />{t.headingTwo}</h2>
      <p className="qr-url">gallery.aleemxnurul.love</p>
      <div className="qr-route"><span>SIN</span><i /><Plane aria-hidden="true" /><i /><span>∞</span></div>
      <dl><div><dt>{t.flight}</dt><dd>AN-210827</dd></div><div><dt>{t.date}</dt><dd>{t.dateValue}</dd></div><div><dt>{t.destination}</dt><dd>{t.forever}</dd></div></dl>
    </section>
  )
}
