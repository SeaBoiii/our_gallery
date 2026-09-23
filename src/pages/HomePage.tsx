import { useEffect, useRef, useState } from 'react'
import { BookOpen, Images, Plus } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { FlightHeader } from '../components/FlightHeader'
import { Hero } from '../components/Hero'
import { GalleryGrid } from '../components/gallery/GalleryGrid'
import { Guestbook } from '../components/guestbook/Guestbook'
import { GreetingComposer } from '../components/guestbook/GreetingComposer'
import { UploadExperience } from '../components/upload/UploadExperience'
import { copy } from '../i18n/copy'
import { useLocale } from '../context/useLocale'

export function HomePage() {
  const { locale } = useLocale()
  const t = copy[locale]
  const location = useLocation()
  const navigate = useNavigate()
  const guestbook = location.pathname === '/guestbook'
  const cameraRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<HTMLInputElement>(null)
  const [uploaderOpen, setUploaderOpen] = useState(false)
  const [greetingOpen, setGreetingOpen] = useState(false)
  const [initialFiles, setInitialFiles] = useState<File[]>([])
  const scrollToGallery = () => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById('gallery')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
  }
  const openUploader = () => { setInitialFiles([]); setUploaderOpen(true) }
  const openGreeting = () => setGreetingOpen(true)
  const acceptSelection = (files: FileList | null) => {
    const selected = Array.from(files || [])
    if (!selected.length) return
    setInitialFiles(selected)
    setUploaderOpen(true)
  }

  useEffect(() => {
    document.title = `Aleem & Nurulain — ${guestbook ? (locale === 'en' ? 'Guestbook' : 'Buku Tetamu') : (locale === 'en' ? 'Our Wedding Collection' : 'Koleksi Perkahwinan Kami')}`
    if (location.hash === '#gallery') {
      const timer = window.setTimeout(() => document.getElementById('gallery')?.scrollIntoView({ behavior: 'auto' }), 0)
      return () => window.clearTimeout(timer)
    }
  }, [guestbook, locale, location.hash])

  return (
    <main className="landing-page">
      <FlightHeader onAddMemory={openUploader} />
      <Hero onAddMemory={openUploader} onLeaveGreeting={openGreeting} onTakePhoto={() => cameraRef.current?.click()} onChooseMedia={() => mediaRef.current?.click()} />
      <div className="gallery-preview" id="gallery">
        <nav className="collection-nav" aria-label={locale === 'en' ? 'Wedding collection' : 'Koleksi perkahwinan'}>
          <Link to="/gallery#gallery" aria-current={!guestbook ? 'page' : undefined}><Images size={17} aria-hidden="true" />{locale === 'en' ? 'The gallery' : 'Galeri'}</Link>
          <Link to="/guestbook#gallery" aria-current={guestbook ? 'page' : undefined}><BookOpen size={17} aria-hidden="true" />{locale === 'en' ? 'The guestbook' : 'Buku tetamu'}</Link>
        </nav>
        {guestbook ? <Guestbook onLeaveGreeting={openGreeting} /> : <section aria-labelledby="gallery-title">
          <p className="eyebrow">{t.galleryEyebrow}</p>
          <div className="gallery-heading-row"><h2 id="gallery-title">{t.galleryTitle}</h2><p>{t.galleryBody}</p></div>
          <GalleryGrid onAddMemory={openUploader} />
        </section>}
      </div>
      <footer className="site-footer"><p>Aleem & Nurulain <span aria-hidden="true">↗</span></p><small>{locale === 'en' ? 'Every memory, a part of our story.' : 'Setiap kenangan, sebahagian kisah kami.'}</small><Link to="/qr">{locale === 'en' ? 'Share the gallery QR' : 'Kongsi QR galeri'}</Link></footer>
      <button className="mobile-share button button-primary" type="button" onClick={guestbook ? openGreeting : openUploader}><Plus size={17} aria-hidden="true" />{guestbook ? (locale === 'en' ? 'Leave a greeting' : 'Tulis ucapan') : (locale === 'en' ? 'Share a memory' : 'Kongsi kenangan')}</button>
      <UploadExperience open={uploaderOpen} initialFiles={initialFiles} onClose={() => setUploaderOpen(false)} onViewGallery={() => { setUploaderOpen(false); navigate('/gallery#gallery'); window.setTimeout(scrollToGallery, 0) }} />
      <GreetingComposer open={greetingOpen} onClose={() => setGreetingOpen(false)} />
      <input ref={cameraRef} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(event) => { acceptSelection(event.currentTarget.files); event.currentTarget.value = '' }} />
      <input ref={mediaRef} className="visually-hidden" type="file" accept="image/*,video/*" multiple tabIndex={-1} aria-hidden="true" onChange={(event) => { acceptSelection(event.currentTarget.files); event.currentTarget.value = '' }} />
    </main>
  )
}
