import { useEffect, useRef, useState } from 'react'
import { Archive, BarChart3, BrainCircuit, Images, LoaderCircle, LogOut, Settings, SquareArrowOutUpRight } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AdminLogin } from '../components/admin/AdminLogin'
import { AdminOverview } from '../components/admin/AdminOverview'
import { ModerationPanel } from '../components/admin/ModerationPanel'
import { SettingsPanel } from '../components/admin/SettingsPanel'
import { WeddingMonogram } from '../components/WeddingMonogram'
import { adminLogout, getAdminSession } from '../services/api'
import { AdminAiPanel } from '../components/admin/AdminAiPanel'
import { FaceCalibrationPanel } from '../components/admin/FaceCalibrationPanel'
import { AdminArchivePanel } from '../components/admin/AdminArchivePanel'

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const location = useLocation()
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const logoutLock = useRef(false)
  useEffect(() => { void getAdminSession().then((session) => setAuthenticated(session.authenticated)).catch(() => setAuthenticated(false)) }, [])
  if (authenticated === null) return <main className="admin-loading">Preparing the control room…</main>
  if (!authenticated) return <AdminLogin onSuccess={() => setAuthenticated(true)} />
  const path = location.pathname.replace(/\/+$/,'') || '/admin'
  const content = path === '/admin/moderation' ? <ModerationPanel /> : path === '/admin/settings' ? <SettingsPanel /> : path === '/admin/ai/face-calibration' ? <FaceCalibrationPanel /> : path === '/admin/ai' ? <AdminAiPanel /> : path === '/admin/archive' ? <AdminArchivePanel /> : <AdminOverview />
  const logout = async () => {
    if (logoutLock.current) return
    logoutLock.current = true
    setLogoutBusy(true)
    setLogoutError(null)
    try {
      const session = await adminLogout()
      if (session.authenticated) throw new Error('The server did not end this session.')
      setAuthenticated(false)
    } catch {
      setLogoutError('Sign out could not be confirmed. Your admin session may still be active; please try again.')
    } finally {
      logoutLock.current = false
      setLogoutBusy(false)
    }
  }
  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <div className="admin-brand"><WeddingMonogram compact /><span><strong>Aleem & Nurul</strong><small>Gallery control</small></span></div>
        <nav aria-label="Admin sections">
          <NavLink to="/admin" end><BarChart3 aria-hidden="true" />Overview</NavLink>
          <NavLink to="/admin/moderation"><Images aria-hidden="true" />Moderation</NavLink>
          <NavLink to="/admin/ai"><BrainCircuit aria-hidden="true" />AI & discovery</NavLink>
          <NavLink to="/admin/archive"><Archive aria-hidden="true" />Archive</NavLink>
          <NavLink to="/admin/settings"><Settings aria-hidden="true" />Settings</NavLink>
        </nav>
        <div className="admin-sidebar-footer"><Link to="/" target="_blank" rel="noreferrer"><SquareArrowOutUpRight aria-hidden="true" />Public gallery</Link><button type="button" onClick={() => void logout()} disabled={logoutBusy} aria-busy={logoutBusy}>{logoutBusy ? <LoaderCircle className="spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}{logoutBusy ? 'Signing out…' : 'Sign out'}</button></div>
      </aside>
      <section className="admin-content">{content}</section>
      {logoutError ? <div className="admin-toast admin-toast--error" role="alert"><span>{logoutError}</span><button type="button" onClick={() => setLogoutError(null)}>Dismiss</button></div> : null}
    </main>
  )
}
