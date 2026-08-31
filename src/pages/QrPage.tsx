import { ArrowLeft, Printer } from 'lucide-react'
import { Link } from 'react-router-dom'
import { QRCodeCard } from '../components/QRCodeCard'
import { useLocale } from '../context/useLocale'
import { copy } from '../i18n/copy'

export default function QrPage() {
  const { locale } = useLocale()
  const t = copy[locale].qr
  return (
    <main className="qr-page">
      <nav className="qr-page-nav" aria-label={t.controls}>
        <Link to="/"><ArrowLeft aria-hidden="true" />{t.back}</Link>
        <button type="button" onClick={() => window.print()}><Printer aria-hidden="true" />{t.print}</button>
      </nav>
      <QRCodeCard />
      <p className="print-note">{t.printNote}</p>
    </main>
  )
}
