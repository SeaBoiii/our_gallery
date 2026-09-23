import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowLeft, Camera, Check, Download, ImagePlus, LoaderCircle, Move, RotateCcw, RotateCw, Upload } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { LanguageToggle } from '../components/LanguageToggle'
import { WeddingMonogram } from '../components/WeddingMonogram'
import { UploadExperience } from '../components/upload/UploadExperience'
import { useLocale } from '../context/useLocale'
import { MAX_IMAGE_SIZE } from '../config'
import { validateFile } from '../utils/files'
import { CameraCapture } from '../features/polaroid/CameraCapture'
import { polaroidCopy } from '../features/polaroid/copy'
import { DEFAULT_POLAROID_SETTINGS, POLAROID_WIDTH, drawPolaroid, exportPolaroid, loadPolaroidPhoto, positionDelta } from '../features/polaroid/render'
import type { LoadedPhoto, PolaroidSettings } from '../features/polaroid/types'
import '../styles/polaroid.css'

type StudioError = 'loadError' | 'sizeError' | 'formatError' | 'renderError' | 'exportError'

export default function PolaroidPage() {
  const { locale } = useLocale()
  const t = polaroidCopy[locale]
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chooserRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<LoadedPhoto | null>(null)
  const previewController = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const active = useRef(true)
  const exportActive = useRef(false)
  const drag = useRef<{ x: number; y: number; settings: PolaroidSettings; scale: number; pointerId: number } | null>(null)
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null)
  const [settings, setSettings] = useState<PolaroidSettings>({ ...DEFAULT_POLAROID_SETTINGS })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<{ photo: LoadedPhoto | null; settings: PolaroidSettings; attempt: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<StudioError | null>(null)
  const [saved, setSaved] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploaderOpen, setUploaderOpen] = useState(false)

  useEffect(() => { document.title = `Aleem & Nurulain — ${t.title}` }, [t.title])
  useEffect(() => {
    active.current = true
    return () => { active.current = false; sequence.current += 1; previewController.current?.abort(); photoRef.current?.dispose(); photoRef.current = null }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    previewController.current = controller
    const frame = window.requestAnimationFrame(() => {
      if (!canvasRef.current) return
      void drawPolaroid(canvasRef.current, photo, settings, { signal: controller.signal }).then(() => {
        if (!controller.signal.aborted) setPreviewVersion({ photo, settings, attempt })
      }).catch(() => { if (!controller.signal.aborted) setError('renderError') })
    })
    return () => { controller.abort(); window.cancelAnimationFrame(frame); if (previewController.current === controller) previewController.current = null }
  }, [photo, settings, attempt])

  const update = (patch: Partial<PolaroidSettings>) => {
    if (exportActive.current) return
    setSettings(current => ({ ...current, ...patch }))
    setSaved(false)
    setError(null)
  }
  const openPhoto = async (file: File | undefined) => {
    if (!file || exportActive.current) return
    const current = ++sequence.current
    setSaved(false); setError(null); setLoading(false)
    const validation = validateFile(file)
    if (file.size > MAX_IMAGE_SIZE) { setError('sizeError'); return }
    if (!validation.valid || validation.mediaType !== 'photo') { setError('formatError'); return }
    setLoading(true)
    try {
      const next = await loadPolaroidPhoto(file)
      if (!active.current || current !== sequence.current) { next.dispose(); return }
      previewController.current?.abort()
      photoRef.current?.dispose()
      photoRef.current = next
      setPhoto(next)
      setSettings(previous => ({ ...previous, zoom: 1, positionX: 0, positionY: 0, rotation: 0 }))
    } catch {
      if (active.current && current === sequence.current) setError('loadError')
    } finally {
      if (active.current && current === sequence.current) setLoading(false)
    }
  }
  const resetCrop = () => update({ zoom: 1, positionX: 0, positionY: 0, rotation: 0 })
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!photo || loading || busy || event.button !== 0) return
    const width = canvasRef.current?.getBoundingClientRect().width || POLAROID_WIDTH
    drag.current = { x: event.clientX, y: event.clientY, settings, scale: POLAROID_WIDTH / width, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || !photo || current.pointerId !== event.pointerId) return
    update(positionDelta(photo, current.settings, (event.clientX - current.x) * current.scale, (event.clientY - current.y) * current.scale))
  }
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const createKeepsake = async (destination: 'download' | 'gallery') => {
    if (!photo || loading || exportActive.current) return
    exportActive.current = true; setBusy(true); setError(null); setSaved(false)
    try {
      const blob = await exportPolaroid(photo, settings)
      if (!active.current) return
      const file = new File([blob], `aleem-nurulain-${settings.frame}-${Date.now()}.png`, { type: 'image/png' })
      if (destination === 'gallery') {
        setUploadFiles([file]); setUploaderOpen(true)
      } else {
        const url = URL.createObjectURL(file)
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = file.name
        document.body.append(anchor)
        try { anchor.click() } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }
        setSaved(true)
      }
    } catch {
      if (active.current) setError('exportError')
    } finally {
      exportActive.current = false
      if (active.current) setBusy(false)
    }
  }
  const controlsDisabled = loading || busy
  const previewReady = previewVersion?.photo === photo && previewVersion?.settings === settings && previewVersion?.attempt === attempt

  return <main className="polaroid-page">
    <header className="studio-header"><Link className="studio-back" to="/gallery#gallery"><ArrowLeft size={16} aria-hidden="true" /><span>{t.back}</span></Link><Link className="studio-brand" to="/" aria-label="Aleem & Nurulain"><WeddingMonogram compact /></Link><LanguageToggle /></header>
    <div className="studio-intro"><p className="eyebrow">{t.eyebrow}</p><h1>{t.heading} <em>{t.headingEm}</em></h1><p>{t.intro}</p></div>
    <div className="studio-layout">
      <section className="studio-preview" aria-label={t.preview}>
        <div className="studio-preview-label"><span>AN / THE KEEPSAKE STUDIO</span><span>01 / 01</span></div>
        <div className="studio-paper-wrap">
          <canvas ref={canvasRef} className="studio-canvas" width="1200" height="1500" role="img" aria-label={`${t.preview} — ${t[settings.frame]}${settings.caption ? ` — ${settings.caption}` : ''}`} />
          {!photo ? <div className="studio-empty-photo"><Camera size={35} strokeWidth={1.1} aria-hidden="true" /><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p><button type="button" className="button button-primary" onClick={() => chooserRef.current?.click()} disabled={controlsDisabled}><ImagePlus size={17} aria-hidden="true" />{t.choose}</button><button type="button" className="studio-camera-link" onClick={() => setCameraOpen(true)} disabled={controlsDisabled}>{t.camera}</button></div> : <div className="studio-drag-surface" role="group" aria-label={t.crop} aria-describedby="crop-hint" tabIndex={controlsDisabled ? -1 : 0}
            onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={() => { drag.current = null }}
            onKeyDown={event => { if (controlsDisabled) return; const steps: Record<string, [number, number]> = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, -35], ArrowDown: [0, 35] }; const delta = steps[event.key]; if (delta) { event.preventDefault(); update(positionDelta(photo, settings, delta[0], delta[1])) } }} />}
          {loading ? <div className="studio-preview-busy" role="status"><LoaderCircle className="spin" aria-hidden="true" />{t.loading}</div> : null}
        </div>
        <p className="studio-drag-hint" id="crop-hint">{photo && !previewReady ? <><LoaderCircle size={13} className="spin" aria-hidden="true" />{t.rendering}</> : photo ? <><Move size={13} aria-hidden="true" />{t.drag}<span className="visually-hidden">{t.keyboardCrop}</span></> : t.formats}</p>
        <p className="studio-privacy">{t.privacy}</p>
      </section>
      <div className="studio-controls">
        <section className="studio-control-section studio-source" aria-labelledby="studio-source-title"><h2 id="studio-source-title"><span aria-hidden="true">01</span>{t.sourceLabel}</h2><div className="studio-source-actions"><button type="button" onClick={() => chooserRef.current?.click()} disabled={controlsDisabled}><ImagePlus size={16} aria-hidden="true" />{photo ? t.replace : t.choose}</button><button type="button" onClick={() => setCameraOpen(true)} disabled={controlsDisabled}><Camera size={16} aria-hidden="true" />{t.camera}</button></div></section>
        <fieldset className="studio-control-section" disabled={controlsDisabled}><legend><span aria-hidden="true">02</span>{t.frame}</legend><div className="studio-frame-options">{(['ivory', 'airmail', 'clouds'] as const).map(frame => <button className={`studio-frame-option studio-frame-option--${frame}`} type="button" key={frame} aria-pressed={settings.frame === frame} onClick={() => update({ frame })}><span className="studio-frame-swatch" aria-hidden="true"><span /><i>A & N</i>{settings.frame === frame ? <Check size={12} /> : null}</span><span>{t[frame]}</span></button>)}</div></fieldset>
        <fieldset className="studio-control-section" disabled={controlsDisabled}><legend><span aria-hidden="true">03</span>{t.details}</legend><div className="studio-field"><label htmlFor="studio-caption">{t.caption}{' '}<small>{t.optional}</small></label><input id="studio-caption" value={settings.caption} onChange={event => update({ caption: event.target.value })} maxLength={60} placeholder={t.captionPlaceholder} autoComplete="off" /><span className="studio-char-count">{settings.caption.length} / 60</span></div><div className="studio-field"><label htmlFor="studio-day">{t.date}</label><select id="studio-day" value={settings.celebration} onChange={event => update({ celebration: event.target.value as PolaroidSettings['celebration'] })}><option value="both">{t.both}</option><option value="solemnisation">{t.dayOne}</option><option value="reception">{t.dayTwo}</option></select></div><div className="studio-finish-options" role="group" aria-label={t.finish}>{(['original', 'warm', 'mono'] as const).map(finish => <button type="button" key={finish} aria-pressed={settings.finish === finish} onClick={() => update({ finish })}>{t[finish]}</button>)}</div></fieldset>
        {photo ? <fieldset className="studio-control-section studio-crop" disabled={controlsDisabled}><legend><span aria-hidden="true">04</span>{t.crop}</legend><label htmlFor="studio-zoom">{t.zoom}<output aria-hidden="true">{settings.zoom.toFixed(1)}×</output></label><input id="studio-zoom" aria-valuetext={`${settings.zoom.toFixed(1)}×`} type="range" min="1" max="3" step="0.05" value={settings.zoom} onChange={event => update({ zoom: Number(event.target.value) })} /><div className="studio-position-sliders"><div><label htmlFor="studio-x">{t.horizontal}</label><input id="studio-x" type="range" min="-1" max="1" step="0.02" value={settings.positionX} onChange={event => update({ positionX: Number(event.target.value) })} /></div><div><label htmlFor="studio-y">{t.vertical}</label><input id="studio-y" type="range" min="-1" max="1" step="0.02" value={settings.positionY} onChange={event => update({ positionY: Number(event.target.value) })} /></div></div><div className="studio-crop-actions"><button type="button" onClick={() => update({ rotation: ((settings.rotation + 90) % 360) as PolaroidSettings['rotation'], positionX: 0, positionY: 0 })}><RotateCw size={14} aria-hidden="true" />{t.rotate}</button><button type="button" onClick={resetCrop}><RotateCcw size={14} aria-hidden="true" />{t.reset}</button></div></fieldset> : null}
        {error ? <div className="studio-error" role="alert"><p>{t[error]}</p>{error === 'renderError' ? <button type="button" onClick={() => { setError(null); setAttempt(value => value + 1) }}>{t.retry}</button> : null}</div> : null}
        <div className="studio-export"><div><button type="button" className="button button-primary" disabled={!photo || controlsDisabled || !previewReady} onClick={() => void createKeepsake('download')}>{busy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}{busy ? t.preparing : t.save}</button><button type="button" className="button button-secondary" disabled={!photo || controlsDisabled || !previewReady} onClick={() => void createKeepsake('gallery')}><Upload size={16} aria-hidden="true" />{t.upload}</button></div><p>{t.output}</p><p className="studio-upload-note">{t.uploadNote}</p>{saved ? <p className="studio-saved" role="status"><Check size={15} aria-hidden="true" />{t.saved}</p> : null}</div>
      </div>
    </div>
    <input ref={chooserRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" tabIndex={-1} aria-hidden="true" onChange={event => { void openPhoto(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
    {cameraOpen ? <CameraCapture onClose={() => setCameraOpen(false)} onCapture={file => { setCameraOpen(false); void openPhoto(file) }} /> : null}
    <UploadExperience key={uploadFiles[0]?.name || 'empty'} open={uploaderOpen} initialFiles={uploadFiles} onClose={() => setUploaderOpen(false)} onViewGallery={() => navigate('/gallery#gallery')} />
    <footer className="studio-footer">Aleem <i>&</i> Nurulain <span>·</span> {locale === 'en' ? 'A little piece of our forever.' : 'Secebis kenangan selamanya.'}</footer>
  </main>
}
