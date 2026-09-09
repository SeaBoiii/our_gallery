import { useEffect, useRef, useState } from 'react'
import { CloudBackdrop } from '../components/CloudBackdrop'
import { FlightHeader } from '../components/FlightHeader'
import { Hero } from '../components/Hero'
import { GalleryGrid } from '../components/gallery/GalleryGrid'
import { UploadExperience } from '../components/upload/UploadExperience'
import { copy } from '../i18n/copy'
import { useLocale } from '../context/useLocale'

export function HomePage() {
  const { locale } = useLocale()
  const t = copy[locale]
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
    if (window.location.pathname === '/gallery') window.setTimeout(() => document.getElementById('gallery')?.scrollIntoView({ behavior: 'auto' }), 0)
  }, [])

  return (
    <main className="landing-page">
      <CloudBackdrop />
      <FlightHeader onAddMemory={openUploader} />
      <Hero onAddMemory={openUploader} onTakePhoto={() => cameraRef.current?.click()} onChooseMedia={() => mediaRef.current?.click()} />
      <section className="gallery-preview" id="gallery" aria-labelledby="gallery-title">
        <p className="eyebrow">{t.galleryEyebrow}</p>
        <div className="gallery-heading-row">
          <h2 id="gallery-title">{t.galleryTitle}</h2>
          <p>{t.galleryBody}</p>
        </div>
        <GalleryGrid onAddMemory={openUploader} />
      </section>
      <UploadExperience
        open={uploaderOpen}
        initialFiles={initialFiles}
        onClose={() => setUploaderOpen(false)}
        onViewGallery={() => { setUploaderOpen(false); window.setTimeout(scrollToGallery, 0) }}
      />
      <input ref={cameraRef} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(event) => { acceptSelection(event.currentTarget.files); event.currentTarget.value = '' }} />
      <input ref={mediaRef} className="visually-hidden" type="file" accept="image/*,video/*" multiple tabIndex={-1} aria-hidden="true" onChange={(event) => { acceptSelection(event.currentTarget.files); event.currentTarget.value = '' }} />
    </main>
  )
}
