import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Camera, ImagePlus } from 'lucide-react'
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

/** The phone action bar appears once the hero's own buttons have scrolled away. */
function useHeroOutOfView() {
  const [outOfView, setOutOfView] = useState(false)
  useEffect(() => {
    const hero = document.getElementById('top')
    if (!hero || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setOutOfView(!entry.isIntersecting), { rootMargin: '0px 0px -35% 0px' })
    observer.observe(hero)
    return () => observer.disconnect()
  }, [])
  return outOfView
}

export function HomePage() {
  const { locale } = useLocale()
  const { config } = useGalleryVisibility()
  const t = copy[locale]
  const english = locale === 'en'
  const location = useLocation()
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<HTMLInputElement>(null)
  const [uploaderOpen, setUploaderOpen] = useState(false)
  const [initialFiles, setInitialFiles] = useState<File[]>([])
  const actionBarVisible = useHeroOutOfView()
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
    document.title = `Aleem & Nurulain — ${english ? 'Our Wedding Gallery' : 'Galeri Perkahwinan Kami'}`
    if (location.hash === '#gallery') {
      const timer = window.setTimeout(() => document.getElementById('gallery')?.scrollIntoView({ behavior: 'auto' }), 0)
      return () => window.clearTimeout(timer)
    }
  }, [english, location.hash])

  return (
    <main className="landing-page">
      <a className="skip-gallery" href="#gallery">{english ? 'Skip to the gallery' : 'Terus ke galeri'}</a>
      <FlightHeader onAddMemory={openUploader} />
      <Hero onAddMemory={openUploader} onTakePhoto={() => cameraRef.current?.click()} onChooseMedia={() => mediaRef.current?.click()} />
      <PolaroidTeaser />
      <section className="gallery-preview" id="gallery" aria-labelledby="gallery-title" tabIndex={-1}>
        <div className="gallery-heading-row">
          <div><p className="eyebrow">{english ? 'Arrivals' : 'Ketibaan'}</p><h2 id="gallery-title">{t.galleryTitle}</h2></div>
          <p>{t.galleryBody}</p>
        </div>
        <GalleryGrid onAddMemory={openUploader} />
      </section>
      <section className="contribution-note" aria-labelledby="contribution-title">
        <h2 id="contribution-title">{english ? <>Every perspective,<br /><em>a little more of our story.</em></> : <>Setiap sudut pandangan,<br /><em>melengkapkan kisah kami.</em></>}</h2>
        <p>{english ? 'No account needed. Choose your favourite photos and we’ll keep them with ours.' : 'Tanpa akaun. Pilih foto kegemaran anda dan kami akan menyimpannya bersama kenangan kami.'}</p>
        <button className="button button-light" type="button" onClick={openUploader}><ImagePlus size={18} aria-hidden="true" />{english ? 'Share your photos' : 'Kongsi foto anda'}</button>
      </section>
      <footer className="site-footer">
        <div className="footer-signature"><WeddingMonogram compact /><p>Aleem &amp; Nurulain<small>{english ? 'The beginning of always.' : 'Permulaan untuk selamanya.'}</small></p></div>
        <span className="footer-date">{galleryDateLabel(config?.mode ?? null, locale, true)}</span>
        <Link to="/qr">{english ? 'Share the gallery QR' : 'Kongsi QR galeri'}<ArrowUpRight size={16} aria-hidden="true" /></Link>
      </footer>
      <div className={`mobile-action-bar${actionBarVisible ? ' is-visible' : ''}`}>
        <button className="button button-primary" type="button" onClick={openUploader}><ImagePlus size={18} aria-hidden="true" />{english ? 'Share photos' : 'Kongsi foto'}</button>
        <Link className="button button-secondary mobile-action-booth" to="/photobooth" aria-label={english ? 'Photo booth' : 'Ruang foto'}><Camera size={19} aria-hidden="true" /></Link>
      </div>
      <UploadExperience open={uploaderOpen} initialFiles={initialFiles} onClose={() => setUploaderOpen(false)} onViewGallery={() => { setUploaderOpen(false); navigate('/gallery#gallery'); window.setTimeout(scrollToGallery, 0) }} />
      <input ref={cameraRef} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(event) => { acceptSelection(event.currentTarget.files); event.currentTarget.value = '' }} />
      <input ref={mediaRef} className="visually-hidden" type="file" accept="image/*" multiple tabIndex={-1} aria-hidden="true" onChange={(event) => { acceptSelection(event.currentTarget.files); event.currentTarget.value = '' }} />
    </main>
  )
}
