import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertCircle, CalendarDays, CheckCircle2, Link2, LoaderCircle, RefreshCw, Unlink } from 'lucide-react'
import type { Appointment } from '../types'
import { connectGoogleAccount, disconnectGoogleAccount, googleAccountStatus, googleCalendarConfigured, syncGoogleAccount, type GoogleAccountStatus } from '../lib/calendar'

export default function GoogleAccountConnection({ session, appointments, reload, notify, onStatusChange }: {
  session: Session | null
  appointments: Appointment[]
  reload: (background?: boolean) => Promise<void>
  notify: (message: string) => void
  onStatusChange?: (connected: boolean) => void
}) {
  const [status, setStatus] = useState<GoogleAccountStatus | null>(null)
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | ''>('')
  const [error, setError] = useState('')
  const syncing = useRef(false)
  const userId = session?.user.id
  const signature = appointments.map(item => [item.id, item.patientId, item.officeId, item.googleEventId, item.startsAt, item.endsAt, item.visitType, item.notes].join(':')).sort().join('|')

  const runSync = useCallback(async (manual = false) => {
    if (syncing.current) return
    syncing.current = true
    if (manual) setBusy('sync')
    setError('')
    try {
      const result = await syncGoogleAccount()
      setStatus({ connected: true, googleEmail: result.googleEmail, lastSyncAt: result.lastSyncAt })
      if (result.changes > 0) await reload(true)
      if (manual) {
        const details = [
          result.imported ? `${result.imported} importati` : '',
          result.pushed ? `${result.pushed} inviati` : '',
          result.updated ? `${result.updated} aggiornati` : '',
          result.deleted ? `${result.deleted} eliminati` : '',
        ].filter(Boolean).join(' · ')
        notify(result.errors ? `Sincronizzazione completata con ${result.errors} errori.${details ? ` ${details}.` : ''}` : details ? `Agenda sincronizzata: ${details}.` : 'Agenda Vatia e Google già allineate.')
      } else if (result.errors) setError(`${result.errors} operazioni non riuscite. Usa “Sincronizza ora” per riprovare.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sincronizzazione Google non riuscita.')
    } finally {
      syncing.current = false
      if (manual) setBusy('')
    }
  }, [notify, reload])

  useEffect(() => {
    if (!userId) { setStatus(null); return }
    let active = true
    setStatus(null); setError('')
    void googleAccountStatus().then(next => { if (active) setStatus(next) }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Impossibile verificare il collegamento Google.')
    })
    return () => { active = false }
  }, [userId])

  useEffect(() => { onStatusChange?.(Boolean(status?.connected)) }, [onStatusChange, status?.connected])

  useEffect(() => {
    if (!status?.connected) return
    const timeout = window.setTimeout(() => void runSync(), 800)
    return () => window.clearTimeout(timeout)
  }, [status?.connected, signature, runSync])

  useEffect(() => {
    if (!status?.connected) return
    const interval = window.setInterval(() => void runSync(), 5 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [status?.connected, runSync])

  async function connect() {
    setBusy('connect'); setError('')
    try {
      const next = await connectGoogleAccount()
      setStatus(next)
      notify(`Account ${next.googleEmail ?? 'Google'} collegato. Avvio la prima sincronizzazione.`)
      await runSync(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Collegamento Google non riuscito.') }
    finally { setBusy('') }
  }

  async function disconnect() {
    if (!window.confirm('Scollegare Google Calendar? Gli appuntamenti già presenti resteranno in entrambe le agende.')) return
    setBusy('disconnect'); setError('')
    try {
      await disconnectGoogleAccount()
      setStatus({ connected: false })
      notify('Account Google scollegato. I dati delle agende non sono stati eliminati.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Scollegamento non riuscito.') }
    finally { setBusy('') }
  }

  if (!session) return null
  const connected = Boolean(status?.connected)
  const lastSync = status?.lastSyncAt ? new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(status.lastSyncAt)) : ''

  return <section className={`google-account-card ${connected ? 'connected' : ''}`} aria-label="Collegamento Google Calendar">
    <div className="google-account-heading">
      <span className="google-account-icon"><CalendarDays size={16} /></span>
      <div><strong>Google Calendar</strong><span>{connected ? status?.googleEmail : status === null ? 'Verifica collegamento…' : 'Account non collegato'}</span></div>
      {connected && <CheckCircle2 size={15} className="google-account-check" />}
    </div>
    <p>{connected ? `Sincronizzazione bidirezionale automatica, anche ad app chiusa.${lastSync ? ` Ultimo sync: ${lastSync}.` : ''}` : 'Collega il tuo account per sincronizzare le visite in entrambe le direzioni.'}</p>
    {error && <div className="google-account-error" role="alert"><AlertCircle size={13} /><span>{error}</span></div>}
    <div className="google-account-actions">
      {connected ? <>
        <button type="button" disabled={Boolean(busy)} onClick={() => void runSync(true)}>{busy === 'sync' ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}{busy === 'sync' ? 'Sincronizzo…' : 'Sincronizza ora'}</button>
        <button type="button" className="google-disconnect" title="Scollega account Google" aria-label="Scollega account Google" disabled={Boolean(busy)} onClick={() => void disconnect()}>{busy === 'disconnect' ? <LoaderCircle size={13} className="spin" /> : <Unlink size={13} />}</button>
      </> : <button type="button" disabled={Boolean(busy) || !googleCalendarConfigured()} onClick={() => void connect()}>{busy === 'connect' ? <LoaderCircle size={13} className="spin" /> : <Link2 size={13} />}{busy === 'connect' ? 'Collegamento…' : 'Collega account Google'}</button>}
    </div>
  </section>
}
