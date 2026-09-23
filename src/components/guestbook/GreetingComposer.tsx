import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, LoaderCircle, X } from 'lucide-react'
import { useLocale } from '../../context/useLocale'
import { useModalFocus } from '../../hooks/useModalFocus'
import { guestbookCopy } from '../../i18n/guestbook'
import { createGreeting, GalleryApiError, getGreetings } from '../../services/api'
import { TurnstileWidget } from '../upload/TurnstileWidget'

type GreetingComposerProps = { open: boolean; onClose: () => void; onSubmitted?: () => void }
type ErrorKind = 'required' | 'tooLong' | 'sendError' | 'rateLimited' | 'verificationFailed' | null

export function GreetingComposer({ open, onClose, onSubmitted }: GreetingComposerProps) {
  const { locale } = useLocale()
  const t = guestbookCopy[locale]
  const [guestName, setGuestName] = useState('')
  const [message, setMessage] = useState('')
  const [token, setToken] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [closed, setClosed] = useState(false)
  const [error, setError] = useState<ErrorKind>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const requestId = useRef<string | null>(null)
  const submissionLock = useRef(false)
  const successRef = useRef(false)
  useModalFocus(dialogRef, open)

  const refreshVerification = useCallback(() => { setToken(''); setResetKey((value) => value + 1) }, [])
  const onVerificationError = useCallback(() => { setToken(''); setError('verificationFailed') }, [])

  useEffect(() => {
    if (!open) return
    let active = true
    // The submission endpoint remains authoritative if availability cannot load.
    void getGreetings({ limit: 1 }).then((page) => { if (active) setClosed(!page.submissionsOpen) }).catch(() => undefined)
    return () => { active = false }
  }, [open])

  const handleClose = useCallback(() => {
    if (submissionLock.current) return
    if (successRef.current) {
      successRef.current = false
      setSuccess(false)
      setGuestName('')
      setMessage('')
      setError(null)
      requestId.current = null
    }
    refreshVerification()
    onClose()
  }, [onClose, refreshVerification])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown) }
  }, [open, handleClose])

  const edited = () => { requestId.current = null; setError(null) }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submissionLock.current || closed || success) return
    if (!message.trim()) { setError('required'); return }
    if (message.trim().length > 1000 || guestName.trim().length > 80) { setError('tooLong'); return }
    if (!token) { setError('verificationFailed'); return }
    submissionLock.current = true
    setBusy(true)
    setError(null)
    requestId.current ??= crypto.randomUUID()
    try {
      await createGreeting({ requestId: requestId.current, guestName: guestName.trim() || undefined, message: message.trim(), turnstileToken: token })
      successRef.current = true
      setSuccess(true)
      onSubmitted?.()
    } catch (reason) {
      if (reason instanceof GalleryApiError && reason.code === 'GREETINGS_CLOSED') setClosed(true)
      else if (reason instanceof GalleryApiError && reason.code === 'RATE_LIMITED') setError('rateLimited')
      else if (reason instanceof GalleryApiError && reason.code.startsWith('TURNSTILE_')) setError('verificationFailed')
      else setError('sendError')
      // Keep requestId: a response may have been lost after a successful write.
      refreshVerification()
    } finally {
      submissionLock.current = false
      setBusy(false)
    }
  }

  if (!open) return null
  return (
    <div className="greeting-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose() }}>
      <div ref={dialogRef} className="greeting-dialog" role="dialog" aria-modal="true" aria-labelledby="greeting-title" aria-describedby="greeting-description" tabIndex={-1}>
        <button className="greeting-close" type="button" aria-label={t.close} disabled={busy} onClick={handleClose}><X size={20} aria-hidden="true" /></button>
        {success ? <div className="greeting-success"><span className="greeting-success-mark"><Check size={26} aria-hidden="true" /></span><p className="eyebrow">{t.successEyebrow}</p><h2 id="greeting-title" tabIndex={-1} data-modal-focus-recovery>{t.successTitle}</h2><p id="greeting-description" role="status">{t.successBody}</p><button type="button" className="button button-primary" onClick={handleClose}>{t.successDone}</button></div> : <form onSubmit={(event) => void submit(event)}>
          <p className="eyebrow">{t.composerEyebrow}</p><h2 id="greeting-title" tabIndex={-1} data-modal-focus-recovery>{t.composerTitle}</h2><p id="greeting-description" className="greeting-dialog-intro">{t.composerBody}</p>
          {closed ? <div className="greeting-closed-notice" role="status"><p>{t.closed}</p><button className="button button-secondary" type="button" onClick={handleClose}>{t.cancel}</button></div> : <>
            <div className="greeting-fields"><label htmlFor="greeting-name">{t.name}<span>{t.optional}</span></label><input id="greeting-name" autoComplete="name" value={guestName} maxLength={80} placeholder={t.namePlaceholder} disabled={busy} data-modal-autofocus onChange={(event) => { edited(); setGuestName(event.target.value) }} />
              <label htmlFor="greeting-message">{t.message}</label><textarea id="greeting-message" value={message} maxLength={1000} rows={5} placeholder={t.messagePlaceholder} disabled={busy} required aria-describedby="greeting-count greeting-moderation" aria-invalid={error === 'required' || error === 'tooLong' || undefined} onChange={(event) => { edited(); setMessage(event.target.value) }} /><span className="greeting-count" id="greeting-count">{message.length.toLocaleString()} / 1,000 {t.characters}</span>
            </div>
            <p id="greeting-moderation" className="greeting-moderation-note">{t.moderation}</p>
            <div className="greeting-verification"><span>{t.verification}</span><TurnstileWidget action="greeting_submit" resetKey={resetKey} onToken={setToken} onError={onVerificationError} /></div>
            {error ? <div className="greeting-error" role="alert"><p>{t[error]}</p>{error === 'verificationFailed' ? <button type="button" onClick={() => { setError(null); refreshVerification() }}>{t.verificationRetry}</button> : null}</div> : null}
            <button className="button button-primary greeting-submit" type="submit" disabled={busy || !token} aria-busy={busy}>{busy ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <ArrowUpRight size={17} aria-hidden="true" />}{busy ? t.sending : t.send}</button>
          </>}
        </form>}
      </div>
    </div>
  )
}
