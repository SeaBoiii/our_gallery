import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, LoaderCircle, Save, ScanFace } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { FaceCalibration, FaceCalibrationComparison } from '../../../shared/contracts'
import { compareFaceCalibration, getFaceCalibrations, saveFaceCalibration } from '../../services/api'

export function FaceCalibrationPanel() {
  const [calibrations, setCalibrations] = useState<FaceCalibration[]>([])
  const [match, setMatch] = useState('')
  const [strong, setStrong] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [left, setLeft] = useState<File | null>(null)
  const [right, setRight] = useState<File | null>(null)
  const [comparison, setComparison] = useState<FaceCalibrationComparison | null>(null)
  const leftRef = useRef<HTMLInputElement>(null)
  const rightRef = useRef<HTMLInputElement>(null)
  useEffect(() => { void getFaceCalibrations().then(({ calibrations: values }) => { setCalibrations(values); const active = values.find((item) => item.active); if (active) { setMatch(String(active.matchThreshold)); setStrong(String(active.strongMatchThreshold)); setNotes(active.notes || '') } }).catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Calibration could not be loaded.')).finally(()=>setLoading(false)) }, [])
  const save = async () => {
    setBusy(true); setMessage(null)
    try {
      const response = await saveFaceCalibration({ matchThreshold:Number(match),strongMatchThreshold:Number(strong),notes,confirmation })
      setCalibrations((current) => [response.calibration,...current.filter((item) => item.id !== response.calibration.id)])
      setMessage('Calibration saved and activated for this exact provider/model/version/dimension/metric combination.')
      setConfirmation('')
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Calibration could not be saved.') }
    finally { setBusy(false) }
  }
  const active = calibrations.find((item) => item.active)
  const compare = async () => {
    if (!left || !right) return
    setBusy(true);setMessage(null);setComparison(null)
    try {
      setComparison(await compareFaceCalibration(left,right));setLeft(null);setRight(null)
      if (leftRef.current) leftRef.current.value = ''
      if (rightRef.current) rightRef.current.value = ''
      setMessage('Comparison complete. The uploaded image bytes and embeddings were not retained.')
    }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'The comparison could not be completed.') }
    finally { setBusy(false) }
  }
  return <div className="calibration-panel">
    <Link className="admin-back-link" to="/admin/ai"><ArrowLeft />AI operations</Link>
    <div className="admin-section-heading"><div><p className="eyebrow">Find Me</p><h1>Face calibration.</h1></div><p>Prefer false negatives over false positives. Never borrow thresholds from another model.</p></div>
    {message ? <div className="moderation-notice" role="status"><AlertTriangle /><span>{message}</span></div> : null}
    <section className="admin-operation-card"><div><p className="settings-card-label">Active model tuple</p>{loading ? <p role="status"><LoaderCircle className="spin" aria-hidden="true" /> Loading calibration…</p> : active ? <dl className="calibration-metadata"><div><dt>Provider</dt><dd>{active.provider}</dd></div><div><dt>Model</dt><dd>{active.model}</dd></div><div><dt>Version</dt><dd>{active.modelVersion}</dd></div><div><dt>Dimensions</dt><dd>{active.dimensions}</dd></div><div><dt>Metric</dt><dd>{active.metric}</dd></div></dl> : <p>No calibrated provider is active. Find Me remains unavailable.</p>}</div></section>
    <section className="admin-operation-card calibration-form"><div><ScanFace /><div><p className="settings-card-label">Transient comparison</p><h2>Compare two known examples</h2><p>Use same-person and different-person pairs. Images and query embeddings stay in request memory only and are discarded after scoring. These are raw vector measurements; confirm how the selected provider/model maps its metric to Vectorize scores before setting thresholds.</p></div></div><div className="calibration-fields"><label><span>First single-face image</span><input ref={leftRef} type="file" disabled={loading || busy} accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event)=>setLeft(event.target.files?.[0] || null)} /></label><label><span>Second single-face image</span><input ref={rightRef} type="file" disabled={loading || busy} accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event)=>setRight(event.target.files?.[0] || null)} /></label></div><button className="button button-secondary" type="button" disabled={loading || !left || !right || busy} onClick={()=>void compare()}>{busy?<LoaderCircle className="spin"/>:<ScanFace/>}Compare transiently</button>{comparison?<dl className="calibration-scores"><div><dt>Cosine similarity</dt><dd>{comparison.cosineSimilarity.toFixed(6)}</dd></div><div><dt>Dot product</dt><dd>{comparison.dotProduct.toFixed(6)}</dd></div><div><dt>Euclidean distance</dt><dd>{comparison.euclideanDistance.toFixed(6)}</dd></div><div><dt>Configured metric</dt><dd>{comparison.metric}</dd></div><div><dt>Image quality</dt><dd>{comparison.leftQuality?.toFixed(3) ?? 'n/a'} / {comparison.rightQuality?.toFixed(3) ?? 'n/a'}</dd></div></dl>:null}</section>
    <section className="admin-operation-card calibration-form"><div><ScanFace /><div><p className="settings-card-label">Threshold review</p><h2>Record tested score boundaries</h2><p>Use known same-person and different-person comparisons outside this tool until a production provider is selected. Record the experiment and sample conditions in notes.</p></div></div><div className="calibration-fields"><label><span>Possible-match threshold</span><input disabled={loading || busy} type="number" step="any" value={match} onChange={(event) => setMatch(event.target.value)} /></label><label><span>Strong-match threshold</span><input disabled={loading || busy} type="number" step="any" value={strong} onChange={(event) => setStrong(event.target.value)} /></label><label className="wide"><span>Calibration notes</span><textarea disabled={loading || busy} value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} /></label><label className="wide"><span>Type USE THESE THRESHOLDS</span><input disabled={loading || busy} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label></div><button className="button button-primary" type="button" disabled={loading || busy || confirmation !== 'USE THESE THRESHOLDS' || !Number.isFinite(Number(match)) || !Number.isFinite(Number(strong)) || Number(strong) < Number(match)} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" /> : <Save />}Activate thresholds</button></section>
  </div>
}
