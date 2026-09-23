import { useRef, useState, type FormEvent } from 'react'
import { KeyRound, LoaderCircle } from 'lucide-react'
import { WeddingMonogram } from '../WeddingMonogram'
import { adminLogin } from '../../services/api'

export function AdminLogin({ onSuccess, notice }: { onSuccess: () => void; notice?: string }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitLock = useRef(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitLock.current) return
    submitLock.current = true
    setBusy(true)
    setError(null)
    try { await adminLogin(password); onSuccess() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Login failed.') }
    finally { submitLock.current = false; setBusy(false) }
  }
  return (
    <main className="admin-login-page">
      <form className="admin-login-card" onSubmit={submit}>
        <WeddingMonogram label="Aleem and Nurulain" />
        <p className="eyebrow">For the wedding team</p>
        <h1>The gallery, cared for.</h1>
        <p>Sign in to review photos and videos, manage uploads, and control the live wall.</p>
        {notice ? <p className="admin-error" role="status">{notice}</p> : null}
        <label><span>Admin password</span><div><KeyRound aria-hidden="true" /><input type="password" value={password} autoComplete="current-password" required onChange={(event) => setPassword(event.target.value)} /></div></label>
        {error ? <p className="admin-error" role="alert">{error}</p> : null}
        <button className="button button-primary" disabled={busy} type="submit">{busy ? <><LoaderCircle className="spin" aria-hidden="true" />Signing in…</> : 'Open gallery dashboard'}</button>
      </form>
    </main>
  )
}
