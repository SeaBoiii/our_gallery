import { useEffect, useRef, useState } from 'react'
import { BarChart3, Images, LoaderCircle, LogOut, MessageSquare, Settings, SquareArrowOutUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AdminLogin } from '../components/admin/AdminLogin'
import { AdminOverview } from '../components/admin/AdminOverview'
import { ModerationPanel } from '../components/admin/ModerationPanel'
import { GreetingModerationPanel } from '../components/admin/GreetingModerationPanel'
import { SettingsPanel } from '../components/admin/SettingsPanel'
import { WeddingMonogram } from '../components/WeddingMonogram'
import { ADMIN_SESSION_EXPIRED_EVENT, adminLogout, getAdminSession } from '../services/api'

type Tab = 'overview' | 'moderation' | 'greetings' | 'settings'

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const logoutLock = useRef(false)
  useEffect(() => { void getAdminSession().then((session) => setAuthenticated(session.authenticated)).catch(() => setAuthenticated(false)) }, [])
  useEffect(() => {
    const expired = () => { setAuthenticated(false); setSessionExpired(true); setLogoutError(null) }
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, expired)
    return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, expired)
  }, [])
  if (authenticated === null) return <main className="admin-loading">Opening the gallery dashboard…</main>
  if (!authenticated) return <AdminLogin notice={sessionExpired ? 'Your admin session has ended. Sign in again to continue.' : undefined} onSuccess={() => { setAuthenticated(true); setSessionExpired(false); setLogoutError(null) }} />
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
        <div className="admin-brand"><WeddingMonogram compact /><span><strong>Aleem & Nurulain</strong><small>Gallery control</small></span></div>
        <nav aria-label="Admin sections">
          <button type="button" aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => setTab('overview')}><BarChart3 aria-hidden="true" />Overview</button>
          <button type="button" aria-current={tab === 'moderation' ? 'page' : undefined} onClick={() => setTab('moderation')}><Images aria-hidden="true" />Moderation</button>
          <button type="button" aria-current={tab === 'greetings' ? 'page' : undefined} onClick={() => setTab('greetings')}><MessageSquare aria-hidden="true" />Greetings</button>
          <button type="button" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}><Settings aria-hidden="true" />Settings</button>
        </nav>
        <div className="admin-sidebar-footer"><Link to="/" target="_blank" rel="noreferrer"><SquareArrowOutUpRight aria-hidden="true" />Public gallery</Link><button type="button" onClick={() => void logout()} disabled={logoutBusy} aria-busy={logoutBusy}>{logoutBusy ? <LoaderCircle className="spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}{logoutBusy ? 'Signing out…' : 'Sign out'}</button></div>
      </aside>
      <section className="admin-content">{tab === 'overview' ? <AdminOverview /> : tab === 'moderation' ? <ModerationPanel /> : tab === 'greetings' ? <GreetingModerationPanel /> : <SettingsPanel />}</section>
      {logoutError ? <div className="admin-toast admin-toast--error" role="alert"><span>{logoutError}</span><button type="button" onClick={() => setLogoutError(null)}>Dismiss</button></div> : null}
    </main>
  )
}
