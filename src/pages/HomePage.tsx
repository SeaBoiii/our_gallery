import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ImagePlus, Plane } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { FlightHeader } from '../components/FlightHeader'
import { Hero } from '../components/Hero'
import { PolaroidTeaser } from '../components/PolaroidTeaser'
import { WeddingMonogram } from '../components/WeddingMonogram'
import { GalleryGrid } from '../components/gallery/GalleryGrid'
import { UploadExperience } from '../components/upload/UploadExperience'
import { copy } from '../i18n/copy'
import { useLocale } from '../context/useLocale'
import { useGalleryVisibility } from '../context/useGalleryVisibility'
import { galleryDateLabel } from '../utils/date'

export function HomePage() {
  const { locale } = useLocale()
  const { config } = useGalleryVisibility()
  const t = copy[locale]
  const location = useLocation()
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<HTMLInputElement>(null)
  const [uploaderOpen, setUploaderOpen] = useState(false)
  const [initialFiles, setInitialFiles] = useState<File[]>([])
  const scrollToGallery = () => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById('gallery')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
  }
  const openUploader = () => { setInitialFiles([]); setUploaderOpen(true) }
  const acceptSelection = (files: FileList | null) => {
    const selected = Array.from(files || [])
    if (!selected.length) return
    setInitialFiles(selected)
    setUploaderOpen(true)
  }

  useEffect(() => {
    document.title = `Aleem & Nurulain — ${locale === 'en' ? 'Our Wedding Gallery' : 'Galeri Perkahwinan Kami'}`
    if (location.hash === '#gallery') {
      const timer = window.setTimeout(() => document.getElementById('gallery')?.scrollIntoView({ behavior: 'auto' }), 0)
      return () => window.clearTimeout(timer)
    }
  }, [locale, location.hash])

  return (
    <main className="landing-page">
      <a className="skip-gallery" href="#gallery">{locale === 'en' ? 'Skip to the gallery' : 'Terus ke galeri'}</a>
      <FlightHeader onAddMemory={openUploader} />
      <Hero onAddMemory={openUploader} onTakePhoto={() => cameraRef.current?.click()} onChooseMedia={() => mediaRef.current?.click()} />
      <PolaroidTeaser />
      <section className="gallery-preview" id="gallery" aria-labelledby="gallery-title" tabIndex={-1}>
        <div className="journal-section-label"><p className="eyebrow">{locale === 'en' ? 'Our collected memories' : 'Koleksi kenangan kita'}</p><span aria-hidden="true">VOL. 01 <Plane size={13} /></span></div>
        <div className="gallery-heading-row"><h2 id="gallery-title">{t.galleryTitle}</h2><p>{t.galleryBody}</p></div>
        <GalleryGrid onAddMemory={openUploader} />
      </section>
      <section className="contribution-note" aria-labelledby="contribution-title">
        <span className="eyebrow">{locale === 'en' ? 'Seen by you. Kept by us.' : 'Dirakam oleh anda. Dikenang oleh kami.'}</span>
        <h2 id="contribution-title">{locale === 'en' ? <>Every perspective.<br /><em>A little more of our story.</em></> : <>Setiap sudut pandangan.<br /><em>Melengkapkan kisah kami.</em></>}</h2>
        <button className="button button-primary" type="button" onClick={openUploader}><ImagePlus size={17} aria-hidden="true" />{locale === 'en' ? 'Add your photos & videos' : 'Tambah foto & video anda'}</button>
        <p>{locale === 'en' ? 'No account needed. Just your favourite moments.' : 'Tanpa akaun. Cukup dengan detik kegemaran anda.'}</p>
      </section>
      <footer className="site-footer"><div className="footer-signature"><WeddingMonogram compact /><p>Aleem & Nurulain<small>{locale === 'en' ? 'The beginning of always.' : 'Permulaan untuk selamanya.'}</small></p></div><span className="footer-date">{galleryDateLabel(config?.mode ?? null, locale, true)}</span><Link to="/qr">{locale === 'en' ? 'Share the gallery QR' : 'Kongsi QR galeri'}<ArrowUpRight size={15} aria-hidden="true" /></Link></footer>
      <button className="mobile-share button button-primary" type="button" onClick={openUploader}><ImagePlus size={17} aria-hidden="true" />{locale === 'en' ? 'Share a memory' : 'Kongsi kenangan'}</button>
      <UploadExperience open={uploaderOpen} initialFiles={initialFiles} onClose={() => setUploaderOpen(false)} onViewGallery={() => { setUploaderOpen(false); navigate('/gallery#gallery'); window.setTimeout(scrollToGallery, 0) }} />
      <input ref={cameraRef} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(event) => { acceptSelection(event.currentTarget.files); event.currentTarget.value = '' }} />
      <input ref={mediaRef} className="visually-hidden" type="file" accept="image/*,video/*" multiple tabIndex={-1} aria-hidden="true" onChange={(event) => { acceptSelection(event.currentTarget.files); event.currentTarget.value = '' }} />
    </main>
  )
}
