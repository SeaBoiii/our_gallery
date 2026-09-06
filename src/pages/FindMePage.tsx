import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, LoaderCircle, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { FindMeAvailability, FindMeResult, GalleryMedia } from '../../shared/contracts'
import { CloudBackdrop } from '../components/CloudBackdrop'
import { FlightHeader } from '../components/FlightHeader'
import { GalleryCollection } from '../components/gallery/GalleryCollection'
import { useLocale } from '../context/useLocale'
import { findMyMemories, GalleryApiError, getFindMeAvailability } from '../services/api'

const text = {
  en: {
    eyebrow: 'Passenger · You', title: 'Find Your Seat in Our Memories', body: "Take a quick selfie and we'll look for wedding memories that may include you.", consent: 'I understand and want to search.', take: 'Take a Selfie', choose: 'Choose a Photo', search: 'Find My Memories', searching: 'Looking through our memories…', privacyTitle: 'How Find Me Works', privacy: ['You submit a selfie voluntarily.', 'A face representation is generated and compared with faces indexed from approved wedding photos.', 'Results are visual-similarity matches—not identity verification.', 'We do not identify you by name or add your selfie to the gallery.', 'The selfie bytes and query representation are discarded after the search.'], unavailable: 'Find Me is not available right now. The full gallery is still open.', results: 'We Found You ✨', resultBody: 'These memories may include you. Similarity matches can occasionally be wrong.', strong: 'Best Matches', possible: 'More Possible Matches', empty: "We couldn't find a strong match yet.", emptyBody: 'Try another selfie with your face clearly visible, or browse the gallery manually.', again: 'Search Again', browse: 'Browse Gallery', selected: 'Selfie ready. Review it before searching.', oneFace: 'We found more than one person. For the best results, use a selfie with just you.', noFace: 'We could not find one clear face. Try another well-lit selfie.', quality: 'Move closer and try again in clear, even light.', tooLarge: 'That image is too large. Try a smaller selfie.', unsupported: 'Choose a JPEG, PNG, WebP, HEIC, or HEIF image.', failed: 'The search could not finish. Your selfie was discarded; please try again.', consentHelp: 'Consent is required before any face processing begins.',
  },
  ms: {
    eyebrow: 'Penumpang · Anda', title: 'Cari Tempat Anda Dalam Kenangan Kami', body: 'Ambil swafoto ringkas dan kami akan mencari kenangan perkahwinan yang mungkin memaparkan anda.', consent: 'Saya faham dan mahu membuat carian.', take: 'Ambil Swafoto', choose: 'Pilih Foto', search: 'Cari Kenangan Saya', searching: 'Mencari dalam kenangan kami…', privacyTitle: 'Cara Cari Saya Berfungsi', privacy: ['Anda menghantar swafoto secara sukarela.', 'Representasi wajah dijana dan dibandingkan dengan wajah dalam foto perkahwinan yang diluluskan.', 'Hasil ialah padanan persamaan visual—bukan pengesahan identiti.', 'Kami tidak mengenal pasti nama anda atau menambah swafoto ke galeri.', 'Data swafoto dan representasi carian dipadam selepas carian.'], unavailable: 'Cari Saya tidak tersedia sekarang. Galeri penuh masih boleh dilihat.', results: 'Kami Menemui Anda ✨', resultBody: 'Kenangan ini mungkin memaparkan anda. Padanan persamaan kadangkala boleh tersilap.', strong: 'Padanan Terbaik', possible: 'Padanan Lain Yang Mungkin', empty: 'Kami belum menemui padanan yang kuat.', emptyBody: 'Cuba swafoto lain dengan wajah jelas, atau terokai galeri secara manual.', again: 'Cari Semula', browse: 'Lihat Galeri', selected: 'Swafoto sedia. Semak sebelum mencari.', oneFace: 'Kami menemui lebih daripada seorang. Gunakan swafoto yang hanya memaparkan anda.', noFace: 'Kami tidak dapat menemui satu wajah yang jelas. Cuba swafoto dengan pencahayaan baik.', quality: 'Dekatkan wajah dan cuba lagi dengan cahaya yang terang dan sekata.', tooLarge: 'Imej itu terlalu besar. Cuba swafoto yang lebih kecil.', unsupported: 'Pilih imej JPEG, PNG, WebP, HEIC, atau HEIF.', failed: 'Carian tidak dapat diselesaikan. Swafoto anda telah dipadam; sila cuba lagi.', consentHelp: 'Persetujuan diperlukan sebelum pemprosesan wajah bermula.',
  },
} as const

async function normaliseSelfie(file: File, maxBytes: number): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new GalleryApiError('Unsupported image', 'SELFIE_TYPE_UNSUPPORTED')
  if (!('createImageBitmap' in window)) {
    if (file.size > maxBytes) throw new GalleryApiError('Image too large', 'SELFIE_TOO_LARGE')
    return file
  }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .88))
    canvas.width = 1
    canvas.height = 1
    if (!blob || blob.size > maxBytes) throw new GalleryApiError('Image too large', 'SELFIE_TOO_LARGE')
    return blob
  } catch (reason) {
    if (reason instanceof GalleryApiError) throw reason
    if (file.size <= maxBytes) return file
    throw new GalleryApiError('Image too large', 'SELFIE_TOO_LARGE')
  }
}

export default function FindMePage() {
  const { locale } = useLocale()
  const t = text[locale]
  const [availability, setAvailability] = useState<FindMeAvailability | null>(null)
  const [consent, setConsent] = useState(false)
  const [selfie, setSelfie] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [result, setResult] = useState<FindMeResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const previewRef = useRef<string | null>(null)
  const searchingRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const resultSessionId = result?.searchSessionId

  const clearSelfie = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setPreview(null)
    setSelfie(null)
    if (cameraRef.current) cameraRef.current.value = ''
    if (pickerRef.current) pickerRef.current.value = ''
  }

  useEffect(() => { void getFindMeAvailability().then(setAvailability).catch(() => setAvailability({ available: false, reason: 'provider_unavailable', maxImageBytes: 6 * 1024 ** 2, sessionTtlSeconds: 600 })) }, [])
  useEffect(() => () => { controller.current?.abort(); if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])
  useEffect(() => {
    if (searching) searchingRef.current?.focus()
    else if (resultSessionId) resultsRef.current?.focus()
  }, [resultSessionId, searching])

  const updateResultItem = (fresh: GalleryMedia) => setResult((current) => current ? {
    ...current,
    strongMatches:current.strongMatches.map((item)=>item.id === fresh.id ? { ...item,...fresh } : item),
    possibleMatches:current.possibleMatches.map((item)=>item.id === fresh.id ? { ...item,...fresh } : item),
  } : current)

  const select = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || !availability) return
    setError(null)
    clearSelfie()
    try {
      const next = await normaliseSelfie(file, availability.maxImageBytes)
      const url = URL.createObjectURL(next)
      previewRef.current = url
      setPreview(url)
      setSelfie(next)
      setResult(null)
    } catch (reason) {
      const code = reason instanceof GalleryApiError ? reason.code : 'REQUEST_FAILED'
      setError(code === 'SELFIE_TOO_LARGE' ? t.tooLarge : t.unsupported)
    }
  }

  const search = async () => {
    if (!consent) { setError(t.consentHelp); return }
    if (!selfie) return
    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    setSearching(true)
    setError(null)
    try {
      setResult(await findMyMemories(selfie, nextController.signal))
    } catch (reason) {
      if (nextController.signal.aborted) return
      const code = reason instanceof GalleryApiError ? reason.code : 'REQUEST_FAILED'
      const messages: Record<string, string> = { NO_FACE_FOUND: t.noFace, MULTIPLE_FACES_FOUND: t.oneFace, SELFIE_QUALITY_LOW: t.quality, SELFIE_TOO_LARGE: t.tooLarge, SELFIE_TYPE_UNSUPPORTED: t.unsupported }
      setError(messages[code] || t.failed)
    } finally {
      if (controller.current === nextController) controller.current = null
      setSearching(false)
      setConsent(false)
      clearSelfie()
    }
  }

  const reset = () => {
    controller.current?.abort()
    clearSelfie()
    setConsent(false)
    setResult(null)
    setError(null)
  }

  return (
    <main className="phase2-page find-me-page">
      <div className="find-me-background" inert={searching ? true : undefined} aria-hidden={searching || undefined}>
        <CloudBackdrop />
        <FlightHeader />
        <section className="find-me-card">
        <div className="passport-heading"><p className="eyebrow">{t.eyebrow}</p><span>AN · 210827</span></div>
        {!availability ? <div className="find-me-state" role="status"><LoaderCircle className="spin" aria-hidden="true" />{t.searching}</div> : !availability.available ? <div className="find-me-state"><ShieldCheck aria-hidden="true" /><h1>{t.title}</h1><p>{t.unavailable}</p><Link className="button button-primary" to="/gallery">{t.browse}</Link></div> : result ? (
          <div ref={resultsRef} className="find-me-results" role="region" aria-labelledby="find-me-results-title" tabIndex={-1}>
            <Sparkles className="result-sparkle" aria-hidden="true" />
            <h1 id="find-me-results-title">{result.totalMatches ? t.results : t.empty}</h1>
            <p>{result.totalMatches ? t.resultBody : t.emptyBody}</p>
            {result.strongMatches.length ? <section><h2>{t.strong}</h2><GalleryCollection items={result.strongMatches} updateMemoryParam={false} onItemUpdate={updateResultItem} /></section> : null}
            {result.possibleMatches.length ? <section><h2>{t.possible}</h2><GalleryCollection items={result.possibleMatches} updateMemoryParam={false} onItemUpdate={updateResultItem} /></section> : null}
            <div className="find-me-actions"><button className="button button-primary" type="button" onClick={reset}><RotateCcw aria-hidden="true" />{t.again}</button><Link className="button button-secondary" to="/gallery">{t.browse}</Link></div>
          </div>
        ) : (
          <>
            <div className="find-me-intro"><h1>{t.title}</h1><p>{t.body}</p></div>
            {preview ? <div className="selfie-preview" role="status"><img src={preview} alt={t.selected} /><p>{t.selected}</p></div> : <div className="selfie-placeholder"><Camera aria-hidden="true" /><span>PASSENGER</span><strong>YOU</strong></div>}
            <div className="find-me-file-actions"><button type="button" onClick={() => cameraRef.current?.click()}><Camera aria-hidden="true" />{t.take}</button><button type="button" onClick={() => pickerRef.current?.click()}><ImagePlus aria-hidden="true" />{t.choose}</button></div>
            <label className="consent-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>{t.consent}</span></label>
            {error ? <p className="find-me-error" role="alert">{error}</p> : null}
            <button className="button button-primary find-me-submit" type="button" onClick={() => void search()} disabled={!selfie || !consent || searching}>{searching ? <LoaderCircle className="spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{searching ? t.searching : t.search}</button>
            <aside className="privacy-panel" aria-labelledby="find-me-privacy-title"><ShieldCheck aria-hidden="true" /><div><h2 id="find-me-privacy-title">{t.privacyTitle}</h2><ol>{t.privacy.map((line) => <li key={line}>{line}</li>)}</ol></div></aside>
          </>
        )}
        </section>
        <input ref={cameraRef} className="visually-hidden" type="file" tabIndex={-1} aria-hidden="true" aria-label={t.take} accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="user" onChange={(event) => void select(event.currentTarget.files)} />
        <input ref={pickerRef} className="visually-hidden" type="file" tabIndex={-1} aria-hidden="true" aria-label={t.choose} accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => void select(event.currentTarget.files)} />
      </div>
      {searching ? <div ref={searchingRef} className="find-me-searching" role="dialog" aria-modal="true" aria-labelledby="find-me-searching-label" tabIndex={-1}><div className="search-route" aria-hidden="true"><i /><span /></div><LoaderCircle className="spin" aria-hidden="true" /><p id="find-me-searching-label">{t.searching}</p></div> : null}
    </main>
  )
}
