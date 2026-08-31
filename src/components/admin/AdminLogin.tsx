import { useState, type FormEvent } from 'react'
import { KeyRound, LoaderCircle } from 'lucide-react'
import { WeddingMonogram } from '../WeddingMonogram'
import { adminLogin } from '../../services/api'

export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try { await adminLogin(password); onSuccess() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Login failed.') }
    finally { setBusy(false) }
  }
  return (
    <main className="admin-login-page">
      <form className="admin-login-card" onSubmit={submit}>
        <WeddingMonogram label="Aleem and Nurul" />
        <p className="eyebrow">Crew access only</p>
        <h1>Gallery control.</h1>
        <p>Sign in to review memories, manage uploads, and control the live wall.</p>
        <label><span>Admin password</span><div><KeyRound aria-hidden="true" /><input type="password" value={password} autoComplete="current-password" required onChange={(event) => setPassword(event.target.value)} /></div></label>
        {error ? <p className="admin-error" role="alert">{error}</p> : null}
        <button className="button button-primary" disabled={busy} type="submit">{busy ? <><LoaderCircle className="spin" aria-hidden="true" />Signing in…</> : 'Open control room'}</button>
      </form>
    </main>
  )
}
