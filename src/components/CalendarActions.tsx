import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Download, LoaderCircle } from 'lucide-react'
import type { Appointment, Office, Patient } from '../types'
import { downloadAppointmentIcs, googleCalendarConfigured, syncAppointmentToGoogle } from '../lib/calendar'

export default function CalendarActions({ appointment, patient, office }: { appointment: Appointment; patient?: Patient; office?: Office }) {
  const [includeLocation, setIncludeLocation] = useState(true)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const configured = googleCalendarConfigured()
  const location = office ? [office.name, office.address, [office.postalCode, office.city, office.province].filter(Boolean).join(' ')].filter(Boolean).join(', ') : ''

  useEffect(() => setFeedback(null), [appointment.id, appointment.startsAt, appointment.endsAt, appointment.visitType, appointment.notes, includeLocation, includeNotes])

  function input() {
    return { appointment, patientName: patient?.name, location: includeLocation ? location : '', includeNotes }
  }
  function exportIcs() {
    try {
      downloadAppointmentIcs(input())
      setFeedback({ kind: 'success', text: 'File .ics scaricato: aprilo con Google Calendar, Apple Calendar o Outlook.' })
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Esportazione non riuscita.' })
    }
  }
  async function syncGoogle() {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await syncAppointmentToGoogle(input())
      setFeedback({ kind: 'success', text: result === 'updated' ? 'Evento Google Calendar aggiornato senza crearne un duplicato.' : 'Evento aggiunto a Google Calendar.' })
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Sincronizzazione Google non riuscita.' })
    } finally { setBusy(false) }
  }

  return <section className="calendar-actions full" aria-label="Esportazione e sincronizzazione calendario">
    <div className="calendar-actions-heading"><span className="calendar-actions-icon"><CalendarDays size={18} /></span><div><h3>Porta la visita nel tuo calendario</h3><p>Esporta subito oppure sincronizza il calendario principale di Google.</p></div></div>
    <div className="calendar-privacy-options">
      <label><input type="checkbox" checked={includeLocation} disabled={!office} onChange={event => setIncludeLocation(event.target.checked)} />Includi sede e indirizzo</label>
      <label><input type="checkbox" checked={includeNotes} disabled={!appointment.notes} onChange={event => setIncludeNotes(event.target.checked)} />Includi note visita</label>
    </div>
    <div className="calendar-actions-buttons"><button className="button secondary" type="button" onClick={exportIcs}><Download size={15} />Esporta .ics</button><button className="button secondary" type="button" disabled={!configured || busy || !appointment.id} onClick={() => void syncGoogle()} title={!configured ? 'Richiede la configurazione del Google OAuth Client ID' : !appointment.id ? 'Salva prima l’appuntamento' : 'Sincronizza con Google Calendar'}>{busy ? <LoaderCircle size={15} className="spin" /> : <CalendarDays size={15} />}{busy ? 'Sincronizzazione…' : 'Google Calendar'}</button></div>
    {!appointment.id && <p className="calendar-actions-note">Salva l’appuntamento per attivare la sincronizzazione diretta.</p>}
    {!configured && <p className="calendar-actions-note">La sincronizzazione diretta richiede il Google OAuth Client ID nelle impostazioni di pubblicazione. L’esportazione .ics è già pronta.</p>}
    {feedback && <p className={`calendar-feedback ${feedback.kind}`} role="status">{feedback.kind === 'success' && <CheckCircle2 size={14} />}{feedback.text}</p>}
  </section>
}
