import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ArrowLeft, ArrowRight, Camera, Check, Download, ImagePlus, LoaderCircle, Move, RotateCcw, RotateCw, Upload } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { LanguageToggle } from '../components/LanguageToggle'
import { WeddingMonogram } from '../components/WeddingMonogram'
import { UploadExperience } from '../components/upload/UploadExperience'
import { useLocale } from '../context/useLocale'
import { MAX_IMAGE_SIZE } from '../config'
import { validateFile } from '../utils/files'
import { CameraCapture } from '../features/polaroid/CameraCapture'
import { polaroidCopy } from '../features/polaroid/copy'
import { DEFAULT_BOOTH_SETTINGS, DEFAULT_PHOTO_CROP, boothPositionDelta, drawPhotobooth, exportPhotobooth, getBoothLayout, loadPolaroidPhoto } from '../features/polaroid/render'
import type { BoothLayout, BoothPhoto, BoothSettings, PhotoCrop } from '../features/polaroid/types'
import '../styles/polaroid.css'

type StudioError = 'loadError' | 'sizeError' | 'formatError' | 'batchError' | 'spaceError' | 'renderError' | 'exportError'
type Photos = (BoothPhoto | null)[]
type CameraSession = { count: 1 | 4; target: number | null }

function PhotoThumbnail({ entry }: { entry: BoothPhoto }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = ref.current?.getContext('2d')
    if (!context) return
    const { photo } = entry
    const scale = Math.max(160 / photo.width, 120 / photo.height)
    context.clearRect(0, 0, 160, 120)
    context.drawImage(photo.source, (160 - photo.width * scale) / 2, (120 - photo.height * scale) / 2, photo.width * scale, photo.height * scale)
  }, [entry])
  return <canvas ref={ref} width={160} height={120} aria-hidden="true" />
}

export default function PolaroidPage() {
  const { locale } = useLocale()
  const t = polaroidCopy[locale]
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chooserRef = useRef<HTMLInputElement>(null)
  const chooserTarget = useRef<number | null>(null)
  const photosRef = useRef<Photos>([null, null, null, null])
  const previewController = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const active = useRef(true)
  const exportActive = useRef(false)
  const drag = useRef<{ x: number; y: number; crop: PhotoCrop; index: number; scale: number; pointerId: number } | null>(null)
  const [photos, setPhotos] = useState<Photos>([null, null, null, null])
  const [settings, setSettings] = useState<BoothSettings>({ ...DEFAULT_BOOTH_SETTINGS })
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<{ photos: Photos; settings: BoothSettings; attempt: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<StudioError | null>(null)
  const [saved, setSaved] = useState(false)
  const [cameraSession, setCameraSession] = useState<CameraSession | null>(null)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploaderOpen, setUploaderOpen] = useState(false)
  const layout = getBoothLayout(settings.layout)
  const required = layout.photoRects.length
  const filled = photos.slice(0, required).filter(Boolean).length
  const selectedPhoto = photos[selected]
  const crop = selectedPhoto?.crop || DEFAULT_PHOTO_CROP
  const controlsDisabled = loading || busy
  const previewReady = previewVersion?.photos === photos && previewVersion?.settings === settings && previewVersion?.attempt === attempt

  useEffect(() => { document.title = `Aleem & Nurulain — ${t.title}` }, [t.title])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false; sequence.current += 1; previewController.current?.abort()
      photosRef.current.forEach(entry => entry?.photo.dispose())
      photosRef.current = [null, null, null, null]
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    previewController.current = controller
    const frame = window.requestAnimationFrame(() => {
      if (!canvasRef.current) return
      void drawPhotobooth(canvasRef.current, photos, settings, { signal: controller.signal }).then(() => {
        if (!controller.signal.aborted) setPreviewVersion({ photos, settings, attempt })
      }).catch(() => { if (!controller.signal.aborted) setError('renderError') })
    })
    return () => { controller.abort(); window.cancelAnimationFrame(frame); if (previewController.current === controller) previewController.current = null }
  }, [photos, settings, attempt])

  const update = (patch: Partial<BoothSettings>) => {
    if (exportActive.current) return
    if (patch.layout) { drag.current = null; if (patch.layout === 'single') setSelected(0) }
    setSettings(current => ({ ...current, ...patch })); setSaved(false); setError(null)
  }
  const commitPhotos = (next: Photos) => {
    previewController.current?.abort()
    photosRef.current = next; setPhotos(next); setSaved(false)
  }
  const updateCrop = (patch: Partial<PhotoCrop>, index = selected) => {
    if (exportActive.current || loading) return
    const entry = photosRef.current[index]
    if (!entry) return
    const next = [...photosRef.current]
    next[index] = { ...entry, crop: { ...entry.crop, ...patch } }
    commitPhotos(next); setError(null)
  }
  const choosePhotos = (target: number | null) => {
    chooserTarget.current = target
    if (chooserRef.current) { chooserRef.current.multiple = target === null && required > 1; chooserRef.current.click() }
  }
  const openPhotos = async (files: File[], target: number | null = null) => {
    if (!files.length || exportActive.current) return
    const current = ++sequence.current
    setSaved(false); setError(null); setLoading(false)
    if (files.length > (target === null ? required : 1)) { setError('batchError'); return }
    for (const file of files) {
      const validation = validateFile(file)
      if (file.size > MAX_IMAGE_SIZE) { setError('sizeError'); return }
      if (!validation.valid || validation.mediaType !== 'photo') { setError('formatError'); return }
    }
    const empty = photosRef.current.slice(0, required).flatMap((entry, index) => entry ? [] : [index])
    if (target === null && files.length > empty.length && files.length !== required) { setError('spaceError'); return }
    const destinations = target !== null ? [target] : empty.length >= files.length ? empty.slice(0, files.length) : files.map((_, index) => index)
    const decoded: BoothPhoto[] = []
    setLoading(true)
    try {
      for (const file of files) {
        const photo = await loadPolaroidPhoto(file)
        decoded.push({ photo, crop: { ...DEFAULT_PHOTO_CROP } })
        if (!active.current || current !== sequence.current) { decoded.forEach(entry => entry.photo.dispose()); return }
      }
      const next = [...photosRef.current]
      previewController.current?.abort()
      destinations.forEach((index, offset) => { next[index]?.photo.dispose(); next[index] = decoded[offset] })
      commitPhotos(next); setSelected(destinations[0])
    } catch {
      decoded.forEach(entry => entry.photo.dispose())
      if (active.current && current === sequence.current) setError('loadError')
    } finally {
      if (active.current && current === sequence.current) setLoading(false)
    }
  }
  const reorder = (direction: -1 | 1) => {
    if (controlsDisabled) return
    const nextIndex = selected + direction
    if (nextIndex < 0 || nextIndex >= required) return
    const next = [...photosRef.current]
    ;[next[selected], next[nextIndex]] = [next[nextIndex], next[selected]]
    commitPhotos(next); setSelected(nextIndex)
  }
  const startDrag = (event: PointerEvent<HTMLDivElement>, index: number) => {
    if (controlsDisabled || event.button !== 0) return
    setSelected(index)
    const entry = photos[index]
    if (!entry) return
    const width = canvasRef.current?.getBoundingClientRect().width || layout.width
    drag.current = { x: event.clientX, y: event.clientY, crop: entry.crop, index, scale: layout.width / width, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const entry = photosRef.current[current.index]
    if (!entry) return
    updateCrop(boothPositionDelta(entry.photo, current.crop, layout.photoRects[current.index], (event.clientX - current.x) * current.scale, (event.clientY - current.y) * current.scale), current.index)
  }
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const createKeepsake = async (destination: 'download' | 'gallery') => {
    if (filled !== required || loading || !previewReady || exportActive.current) return
    exportActive.current = true; setBusy(true); setError(null); setSaved(false)
    try {
      const blob = await exportPhotobooth(photos, settings)
      if (!active.current) return
      const file = new File([blob], `aleem-nurulain-${settings.layout}-${settings.frame}-${Date.now()}.png`, { type: 'image/png' })
      if (destination === 'gallery') { setUploadFiles([file]); setUploaderOpen(true) }
      else {
        const url = URL.createObjectURL(file)
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = file.name; document.body.append(anchor)
        try { anchor.click() } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }
        setSaved(true)
      }
    } catch { if (active.current) setError('exportError') }
    finally { exportActive.current = false; if (active.current) setBusy(false) }
  }
  const startBooth = () => setCameraSession({ count: required === 1 ? 1 : 4, target: null })

  return <main className="polaroid-page">
    <header className="studio-header"><Link className="studio-back" to="/gallery#gallery"><ArrowLeft size={16} aria-hidden="true" /><span>{t.back}</span></Link><Link className="studio-brand" to="/" aria-label="Aleem & Nurulain"><WeddingMonogram compact /></Link><LanguageToggle /></header>
    <div className="studio-intro"><p className="eyebrow">{t.eyebrow}</p><h1>{t.heading} <em>{t.headingEm}</em></h1><p>{t.intro}</p></div>
    <div className="studio-layout">
      <div className="studio-controls">
        <section className="studio-control-section studio-source" aria-labelledby="studio-source-title"><p className="studio-source-eyebrow">{locale === 'en' ? 'ALL ABOARD, MAKE A MEMORY' : 'JOM CIPTA KENANGAN'}</p><h2 id="studio-source-title">{t.sourceLabel}</h2><p className="studio-source-description">{filled === 0 ? t.emptyBody : t.pickHint}</p><div className="studio-source-actions"><button className="studio-start-booth" type="button" onClick={startBooth} disabled={controlsDisabled}><Camera size={17} aria-hidden="true" />{required === 1 ? t.takeOne : t.camera}</button><button type="button" onClick={() => choosePhotos(null)} disabled={controlsDisabled}><ImagePlus size={17} aria-hidden="true" />{t.choose}</button></div><p className="studio-source-note">{required === 4 ? t.boothHint : t.formats}</p></section>
        <fieldset className="studio-control-section studio-template" disabled={controlsDisabled}><legend><span aria-hidden="true">01</span>{t.layout}</legend><div className="studio-layout-options">{(['strip', 'grid', 'single'] as BoothLayout[]).map(value => <button type="button" key={value} aria-pressed={settings.layout === value} onClick={() => update({ layout: value })}><span className={`studio-layout-icon studio-layout-icon--${value}`} aria-hidden="true">{Array.from({ length: value === 'single' ? 1 : 4 }, (_, index) => <i key={index} />)}</span><span>{t[value]}<small>{t[`${value}Detail`]}</small></span>{settings.layout === value ? <Check size={15} aria-hidden="true" /> : null}</button>)}</div></fieldset>
        <section className="studio-preview" aria-label={t.preview}>
          <div className="studio-preview-label"><span>AN / THE WEDDING PHOTO BOOTH</span><span aria-live="polite">{String(filled).padStart(2, '0')} / {String(required).padStart(2, '0')}</span></div>
          <div className={`studio-paper-wrap studio-paper-wrap--${settings.layout}`} style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
            <canvas ref={canvasRef} className="studio-canvas" width={layout.width} height={layout.height} role="img" aria-label={`${t.preview} — ${t[settings.layout]}, ${t[settings.frame]}${settings.caption ? ` — ${settings.caption}` : ''}`} />
            {layout.photoRects.map((rect, index) => {
              const entry = photos[index]
              const position: CSSProperties = { left: `${rect.x / layout.width * 100}%`, top: `${rect.y / layout.height * 100}%`, width: `${rect.width / layout.width * 100}%`, height: `${rect.height / layout.height * 100}%` }
              return entry ? <div key={index} style={position} className={`studio-drag-surface${selected === index ? ' is-selected' : ''}`} role="group" aria-label={`${t.crop} ${index + 1}`} aria-describedby="crop-hint" tabIndex={controlsDisabled ? -1 : 0}
                onFocus={() => setSelected(index)} onPointerDown={event => startDrag(event, index)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={() => { drag.current = null }}
                onKeyDown={event => { if (controlsDisabled) return; const steps: Record<string, [number, number]> = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, -35], ArrowDown: [0, 35] }; const delta = steps[event.key]; if (delta) { event.preventDefault(); updateCrop(boothPositionDelta(entry.photo, entry.crop, rect, delta[0], delta[1]), index) } }}><span className="studio-cell-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span></div> : <button key={index} type="button" className="studio-empty-cell" style={position} disabled={controlsDisabled} aria-label={`${t.choose} — ${t.shot} ${index + 1}`} onClick={() => choosePhotos(index)}><span>{String(index + 1).padStart(2, '0')}</span><ImagePlus size={21} strokeWidth={1.2} aria-hidden="true" /><small>{t.shot} {index + 1}</small></button>
            })}
            {loading ? <div className="studio-preview-busy" role="status"><LoaderCircle className="spin" aria-hidden="true" />{t.loading}</div> : null}
          </div>
          <p className="studio-drag-hint" id="crop-hint">{error === 'renderError' ? null : filled && !previewReady ? <><LoaderCircle size={13} className="spin" aria-hidden="true" />{t.rendering}</> : filled ? <><Move size={13} aria-hidden="true" />{t.drag}<span className="visually-hidden">{t.keyboardCrop}</span></> : t.formats}</p>
          <p className="studio-privacy">{t.privacy}</p>
          {error === 'renderError' ? <div className="studio-error" role="alert"><p>{t.renderError}</p><button type="button" onClick={() => { setError(null); setAttempt(value => value + 1) }}>{t.retry}</button></div> : null}
        </section>
        <fieldset className="studio-control-section studio-shots" disabled={controlsDisabled}><legend><span aria-hidden="true">02</span>{t.shots}<small>{filled}/{required}</small></legend><div className="studio-shot-list">{photos.slice(0, required).map((entry, index) => <button type="button" key={index} aria-label={`${t.shot} ${index + 1}${entry ? '' : ` — ${t.emptyShot}`}`} aria-pressed={selected === index} onClick={() => setSelected(index)}>{entry ? <PhotoThumbnail entry={entry} /> : <ImagePlus size={18} aria-hidden="true" />}<span>{String(index + 1).padStart(2, '0')}</span></button>)}</div><div className="studio-selected-shot"><span>{t.selectedShot} {selected + 1}</span><div><button type="button" onClick={() => choosePhotos(selected)}><ImagePlus size={14} aria-hidden="true" />{selectedPhoto ? t.replace : t.choose}</button><button type="button" onClick={() => setCameraSession({ count: 1, target: selected })}><Camera size={14} aria-hidden="true" />{selectedPhoto ? t.retake : t.takeOne}</button></div></div>{required > 1 ? <div className="studio-reorder"><button type="button" onClick={() => reorder(-1)} disabled={controlsDisabled || selected === 0}><ArrowLeft size={14} aria-hidden="true" />{t.earlier}</button><button type="button" onClick={() => reorder(1)} disabled={controlsDisabled || selected === required - 1}>{t.later}<ArrowRight size={14} aria-hidden="true" /></button></div> : null}</fieldset>
        <fieldset className="studio-control-section" disabled={controlsDisabled}><legend><span aria-hidden="true">03</span>{t.frame}</legend><div className="studio-frame-options">{(['ivory', 'airmail', 'clouds'] as const).map(frame => <button className={`studio-frame-option studio-frame-option--${frame}`} type="button" key={frame} aria-pressed={settings.frame === frame} onClick={() => update({ frame })}><span className="studio-frame-swatch" aria-hidden="true"><span /><i>A & N</i>{settings.frame === frame ? <Check size={12} /> : null}</span><span>{t[frame]}</span></button>)}</div></fieldset>
        <fieldset className="studio-control-section" disabled={controlsDisabled}><legend><span aria-hidden="true">04</span>{t.details}</legend><div className="studio-field"><label htmlFor="studio-caption">{t.caption}{' '}<small>{t.optional}</small></label><input id="studio-caption" value={settings.caption} onChange={event => update({ caption: event.target.value })} maxLength={60} placeholder={t.captionPlaceholder} autoComplete="off" /><span className="studio-char-count">{settings.caption.length} / 60</span></div><div className="studio-field"><label htmlFor="studio-day">{t.date}</label><select id="studio-day" value={settings.celebration} onChange={event => update({ celebration: event.target.value as BoothSettings['celebration'] })}><option value="both">{t.both}</option><option value="solemnisation">{t.dayOne}</option><option value="reception">{t.dayTwo}</option></select></div><div className="studio-finish-options" role="group" aria-label={t.finish}>{(['original', 'warm', 'mono'] as const).map(finish => <button type="button" key={finish} aria-pressed={settings.finish === finish} onClick={() => update({ finish })}>{t[finish]}</button>)}</div></fieldset>
        {selectedPhoto ? <fieldset className="studio-control-section studio-crop" disabled={controlsDisabled}><legend><span aria-hidden="true">05</span>{t.crop}<small>{selected + 1}</small></legend><label htmlFor="studio-zoom">{t.zoom}<output aria-hidden="true">{crop.zoom.toFixed(1)}×</output></label><input id="studio-zoom" aria-valuetext={`${crop.zoom.toFixed(1)}×`} type="range" min="1" max="3" step="0.05" value={crop.zoom} onChange={event => updateCrop({ zoom: Number(event.target.value) })} /><div className="studio-position-sliders"><div><label htmlFor="studio-x">{t.horizontal}</label><input id="studio-x" type="range" min="-1" max="1" step="0.02" value={crop.positionX} onChange={event => updateCrop({ positionX: Number(event.target.value) })} /></div><div><label htmlFor="studio-y">{t.vertical}</label><input id="studio-y" type="range" min="-1" max="1" step="0.02" value={crop.positionY} onChange={event => updateCrop({ positionY: Number(event.target.value) })} /></div></div><div className="studio-crop-actions"><button type="button" onClick={() => updateCrop({ rotation: ((crop.rotation + 90) % 360) as PhotoCrop['rotation'], positionX: 0, positionY: 0 })}><RotateCw size={14} aria-hidden="true" />{t.rotate}</button><button type="button" onClick={() => updateCrop(DEFAULT_PHOTO_CROP)}><RotateCcw size={14} aria-hidden="true" />{t.reset}</button></div></fieldset> : null}
        {error && error !== 'renderError' ? <div className="studio-error" role="alert"><p>{t[error]}</p></div> : null}
        <div className="studio-export"><div><button type="button" className="button button-primary" disabled={filled !== required || controlsDisabled || !previewReady} onClick={() => void createKeepsake('download')}>{busy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}{busy ? t.preparing : t.save}</button><button type="button" className="button button-secondary" disabled={filled !== required || controlsDisabled || !previewReady} onClick={() => void createKeepsake('gallery')}><Upload size={16} aria-hidden="true" />{t.upload}</button></div>{filled !== required ? <p className="studio-completion-note">{filled}/{required} {t.filled}. {t.addRemaining}</p> : null}<p>{layout.width} × {layout.height} {t.output}</p><p className="studio-upload-note">{t.uploadNote}</p>{saved ? <p className="studio-saved" role="status"><Check size={15} aria-hidden="true" />{t.saved}</p> : null}</div>
      </div>
    </div>
    <input ref={chooserRef} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" tabIndex={-1} aria-hidden="true" onChange={event => { void openPhotos(Array.from(event.currentTarget.files || []), chooserTarget.current); event.currentTarget.value = '' }} />
    {cameraSession ? <CameraCapture shotCount={cameraSession.count} onClose={() => setCameraSession(null)} onComplete={files => { const target = cameraSession.target; setCameraSession(null); void openPhotos(files, target) }} /> : null}
    <UploadExperience key={uploadFiles[0]?.name || 'empty'} open={uploaderOpen} initialFiles={uploadFiles} onClose={() => setUploaderOpen(false)} onViewGallery={() => navigate('/gallery#gallery')} />
    <footer className="studio-footer">Aleem <i>&</i> Nurulain <span>·</span> {locale === 'en' ? 'A little piece of our forever.' : 'Secebis kenangan selamanya.'}</footer>
  </main>
}
