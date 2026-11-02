import { useState } from 'react'
import { CalendarDays, CheckCircle2, Download, LoaderCircle, ShieldCheck } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import { listGoogleCalendarEvents } from '../lib/calendar'
import type { GoogleCalendarEvent } from '../lib/calendar'
import { dateKey, formatDate, formatDateTime, formatTime } from '../lib/clinical'
import type { Appointment, Patient } from '../types'
import { EmptyState, Modal } from './UI'

type ImportRow = {
  event: GoogleCalendarEvent
  selected: boolean
  patientId: string
  existing?: Appointment
  supported: boolean
  changed: boolean
}

const normalized = (value: string) => value.trim().toLocaleLowerCase('it-IT')

function suggestedPatient(event: GoogleCalendarEvent, patients: Patient[]) {
  const summary = normalized(event.summary ?? '')
  return patients.find(patient => summary.includes(normalized(patient.name)))
}

function eventVisitType(event: GoogleCalendarEvent, patient?: Patient) {
  let title = (event.summary ?? '').trim() || 'Appuntamento Google'
  if (patient) {
    const escaped = patient.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title.replace(new RegExp(`\\s*[·|–—-]\\s*${escaped}\\s*$`, 'i'), '').trim() || 'Visita'
  }
  return title
}

function sameSchedule(existing: Appointment, event: GoogleCalendarEvent, patient?: Patient) {
  return new Date(existing.startsAt).getTime() === new Date(event.start?.dateTime ?? '').getTime()
    && new Date(existing.endsAt).getTime() === new Date(event.end?.dateTime ?? '').getTime()
    && existing.visitType === eventVisitType(event, patient)
}

export default function GoogleCalendarImport({ workspace, initialDate, onClose, onImported, notify }: { workspace: Workspace; initialDate: Date; onClose: () => void; onImported: (date: string) => void; notify: (message: string) => void }) {
  const [from, setFrom] = useState(dateKey(initialDate))
  const [to, setTo] = useState(() => { const date = new Date(initialDate); date.setDate(date.getDate() + 30); return dateKey(date) })
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadEvents() {
    if (!from || !to) { setError('Seleziona entrambe le date dell’intervallo.'); return }
    setLoading(true); setError('')
    try {
      const timeMin = new Date(`${from}T00:00:00`).toISOString()
      const timeMax = new Date(`${to}T23:59:59.999`).toISOString()
      const events = await listGoogleCalendarEvents(timeMin, timeMax)
      setRows(events.map(event => {
        const linkedId = event.extendedProperties?.private?.vatiaAppointmentId
        const existing = workspace.appointments.find(item => item.googleEventId === event.id || (linkedId && item.id === linkedId))
        const suggestion = existing ? workspace.patients.find(patient => patient.id === existing.patientId) : suggestedPatient(event, workspace.patients)
        const supported = Boolean(event.start?.dateTime && event.end?.dateTime && new Date(event.start.dateTime).getTime() < new Date(event.end.dateTime).getTime())
        const changed = Boolean(existing && supported && !sameSchedule(existing, event, suggestion))
        return { event, existing, supported, changed, selected: supported && (!existing || changed), patientId: suggestion?.id ?? '' }
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile leggere Google Calendar.')
    } finally { setLoading(false) }
  }

  function updateRow(eventId: string, update: Partial<ImportRow>) {
    setRows(current => current?.map(row => row.event.id === eventId ? { ...row, ...update } : row) ?? null)
  }

  const selectedRows = rows?.filter(row => row.selected && row.supported) ?? []

  async function importSelected() {
    if (!selectedRows.length) return
    setSaving(true); setError('')
    let imported = 0
    let updated = 0
    try {
      for (const row of selectedRows) {
        const patient = workspace.patients.find(item => item.id === row.patientId)
        const input = {
          patientId: row.patientId || null,
          startsAt: row.event.start!.dateTime!,
          endsAt: row.event.end!.dateTime!,
          visitType: eventVisitType(row.event, patient),
          googleEventId: row.event.id,
          googleUpdatedAt: row.event.updated,
          lastSyncedAt: new Date().toISOString(),
        }
        if (row.existing) {
          await workspace.updateAppointment({ ...row.existing, ...input })
          updated += 1
        } else {
          await workspace.addAppointment({ ...input, notes: '' })
          imported += 1
        }
      }
      const firstDate = dateKey(new Date(selectedRows[0].event.start!.dateTime!))
      onImported(firstDate)
      notify([imported ? `${imported} appuntamenti importati` : '', updated ? `${updated} appuntamenti aggiornati` : ''].filter(Boolean).join(' · '))
      onClose()
    } catch {
      setError(`Operazione interrotta dopo ${imported + updated} modifiche. Ricarica gli eventi prima di riprovare: quelli già salvati verranno riconosciuti.`)
    } finally { setSaving(false) }
  }

  return <Modal title="Importa da Google Calendar" description="Controlla ogni evento prima di aggiungerlo o aggiornarlo nell’agenda di Vatia." onClose={() => { if (!saving) onClose() }} wide>
    <div className="calendar-import-privacy"><ShieldCheck size={18} /><div><strong>Tu decidi cosa entrare in Vatia</strong><p>Vengono letti solo titolo, data e ora. Descrizioni, note e partecipanti non vengono importati.</p></div></div>
    <div className="calendar-import-range">
      <label><span>Dal</span><input type="date" aria-label="Importa eventi dalla data" value={from} onChange={event => { setFrom(event.target.value); setRows(null) }} /></label>
      <label><span>Al</span><input type="date" aria-label="Importa eventi fino alla data" value={to} min={from} onChange={event => { setTo(event.target.value); setRows(null) }} /></label>
      <button className="button primary" type="button" disabled={loading || saving} onClick={() => void loadEvents()}>{loading ? <LoaderCircle size={16} className="spin" /> : <CalendarDays size={16} />}{loading ? 'Lettura…' : rows ? 'Aggiorna elenco' : 'Mostra eventi'}</button>
    </div>
    {error && <p className="calendar-feedback error" role="alert">{error}</p>}
    {rows && <div className="calendar-import-results">
      <div className="calendar-import-summary"><strong>{rows.length} eventi trovati</strong><span>{selectedRows.length} selezionati</span></div>
      {rows.length ? <div className="calendar-import-list">{rows.map(row => {
        const title = row.event.summary?.trim() || 'Senza titolo'
        const patient = workspace.patients.find(item => item.id === row.patientId)
        const status = !row.supported ? 'Tutto il giorno' : row.changed ? 'Da aggiornare' : row.existing ? 'Già in agenda' : 'Nuovo'
        return <article key={row.event.id} className={`calendar-import-row ${row.selected ? 'selected' : ''}`}>
          <input type="checkbox" aria-label={`Seleziona ${title}`} checked={row.selected} disabled={!row.supported || saving || Boolean(row.existing && !row.changed)} onChange={event => updateRow(row.event.id, { selected: event.target.checked })} />
          <div className="calendar-import-event"><div><strong>{title}</strong><span className={`badge ${row.changed ? 'warning' : row.existing ? 'neutral' : ''}`}>{status}</span></div><p>{row.supported ? `${formatDateTime(row.event.start!.dateTime!)} · ${formatTime(row.event.start!.dateTime!)}–${formatTime(row.event.end!.dateTime!)}` : `${row.event.start?.date ? formatDate(row.event.start.date) : 'Data non valida'} · evento di un giorno`}</p></div>
          <select aria-label={`Paziente per ${title}`} value={row.patientId} disabled={!row.supported || saving || Boolean(row.existing && !row.changed)} onChange={event => updateRow(row.event.id, { patientId: event.target.value })}><option value="">Impegno di studio</option>{workspace.patients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          {row.selected && <CheckCircle2 className="calendar-import-check" size={17} aria-label={patient ? `Associato a ${patient.name}` : 'Pronto per l’importazione'} />}
        </article>
      })}</div> : <EmptyState icon={<CalendarDays size={26} />} title="Nessun evento nel periodo" text="Prova ad ampliare l’intervallo di date." />}
    </div>}
    <div className="modal-form-actions calendar-import-footer"><span>{rows ? 'Gli eventi già presenti non verranno duplicati.' : 'Google potrebbe chiederti di autorizzare l’accesso.'}</span><button className="button secondary" type="button" disabled={saving} onClick={onClose}>Annulla</button>{rows && <button className="button primary" type="button" disabled={!selectedRows.length || saving} onClick={() => void importSelected()}>{saving ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{saving ? 'Importazione…' : `Importa ${selectedRows.length || ''}`}</button>}</div>
  </Modal>
}
