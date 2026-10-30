import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, GripVertical, Plus, ReceiptText, Trash2, UserRound } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import { appointmentDateKey, dateKey, formatDate, formatTime, todayKey } from '../lib/clinical'
import type { Appointment } from '../types'
import { DAY_SHORT } from '../types'
import { EmptyState, Field, Modal, PatientAvatar } from './UI'

const START_HOUR = 7
const END_HOUR = 21
const HOUR_HEIGHT = 72
const TOTAL_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT
const pad = (value: number) => String(value).padStart(2, '0')
const minutes = (value: Date) => value.getHours() * 60 + value.getMinutes()
const timeValue = (value: number) => `${pad(Math.floor(value / 60))}:${pad(value % 60)}`
const localIso = (day: Date, value: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(value / 60), value % 60, 0, 0).toISOString()
const startOfWeek = (source: Date) => { const date = new Date(source); date.setDate(date.getDate() - (date.getDay() + 6) % 7); date.setHours(12, 0, 0, 0); return date }

type Editor = { id?: string; patientId: string; date: string; start: string; end: string; visitType: string; notes: string }
type Positioned = Appointment & { column: number; columns: number }

function layoutDay(items: Appointment[]): Positioned[] {
  const sorted = [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const columns: number[] = []
  const positions = sorted.map(item => {
    const start = new Date(item.startsAt).getTime()
    const end = new Date(item.endsAt).getTime()
    let column = columns.findIndex(value => value <= start)
    if (column < 0) { column = columns.length; columns.push(end) } else columns[column] = end
    return { item, column }
  })
  return positions.map(({ item, column }) => {
    const start = new Date(item.startsAt).getTime(); const end = new Date(item.endsAt).getTime()
    const overlapping = positions.filter(other => new Date(other.item.startsAt).getTime() < end && new Date(other.item.endsAt).getTime() > start)
    return { ...item, column, columns: Math.max(1, ...overlapping.map(other => other.column + 1)) }
  })
}

export default function AgendaView({ workspace, initialPatientId, onSelectPatient, onBill, notify }: { workspace: Workspace; initialPatientId: string; onSelectPatient: (id: string) => void; onBill: (appointment: Appointment) => void; notify: (message: string) => void }) {
  const [reference, setReference] = useState(() => startOfWeek(new Date()))
  const [view, setView] = useState<'week' | 'day' | 'agenda'>('week')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropPreview, setDropPreview] = useState<{ day: string; start: number; duration: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [resize, setResize] = useState<{ appointment: Appointment; startY: number; end: number } | null>(null)
  const dragged = useRef<Appointment | null>(null)
  const suppressClick = useRef(false)
  const weekStart = useMemo(() => startOfWeek(reference), [reference])
  const days = useMemo(() => Array.from({ length: view === 'week' ? 7 : 1 }, (_, index) => { const day = new Date(view === 'week' ? weekStart : reference); day.setDate(day.getDate() + index); return day }), [reference, view, weekStart])
  const rangeAppointments = workspace.appointments.filter(item => days.some(day => appointmentDateKey(item.startsAt) === dateKey(day)))
  const now = new Date()
  const nowTop = (minutes(now) - START_HOUR * 60) / 60 * HOUR_HEIGHT

  useEffect(() => {
    if (!resize) return
    const move = (event: PointerEvent) => {
      const originalEnd = new Date(resize.appointment.endsAt).getTime()
      const start = new Date(resize.appointment.startsAt).getTime()
      const originalDuration = Math.round((originalEnd - start) / 60000)
      const delta = Math.round((event.clientY - resize.startY) / (HOUR_HEIGHT / 2)) * 30
      const duration = Math.max(30, Math.min(240, originalDuration + delta))
      setResize(current => current ? { ...current, end: minutes(new Date(current.appointment.startsAt)) + duration } : null)
    }
    const up = () => {
      const item = resize.appointment
      void workspace.updateAppointment({ ...item, endsAt: localIso(new Date(item.startsAt), resize.end) }).then(() => notify('Durata della visita aggiornata.')).catch(() => {})
      setResize(null)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [resize, workspace, notify])

  function openNew(day = new Date(), start = 9 * 60) {
    const duration = workspace.services.find(service => service.active)?.duration ?? 45
    setEditor({ patientId: initialPatientId, date: dateKey(day), start: timeValue(start), end: timeValue(Math.min(start + duration, END_HOUR * 60)), visitType: 'Visita di controllo', notes: '' })
  }
  function openEdit(item: Appointment) {
    if (suppressClick.current) { suppressClick.current = false; return }
    const start = new Date(item.startsAt); const end = new Date(item.endsAt)
    setEditor({ id: item.id, patientId: item.patientId ?? '', date: dateKey(start), start: timeValue(minutes(start)), end: timeValue(minutes(end)), visitType: item.visitType, notes: item.notes })
  }
  function shift(amount: number) { const next = new Date(reference); next.setDate(next.getDate() + amount * (view === 'week' ? 7 : 1)); setReference(next) }
  function fromEditor(value: Editor): Appointment {
    const [year, month, day] = value.date.split('-').map(Number)
    const date = new Date(year, month - 1, day, 12)
    const [startH, startM] = value.start.split(':').map(Number); const [endH, endM] = value.end.split(':').map(Number)
    return { id: value.id ?? '', patientId: value.patientId || null, startsAt: localIso(date, startH * 60 + startM), endsAt: localIso(date, endH * 60 + endM), visitType: value.visitType, notes: value.notes }
  }
  function overlaps(item: Appointment) {
    return workspace.appointments.some(other => other.id !== item.id && new Date(other.startsAt).getTime() < new Date(item.endsAt).getTime() && new Date(other.endsAt).getTime() > new Date(item.startsAt).getTime())
  }
  async function saveEditor(event: React.FormEvent) {
    event.preventDefault()
    if (!editor) return
    const item = fromEditor(editor)
    if (new Date(item.endsAt) <= new Date(item.startsAt)) { notify('L’orario di fine deve essere successivo all’inizio.'); return }
    setSaving(true)
    try {
      if (item.id) await workspace.updateAppointment(item)
      else await workspace.addAppointment({ patientId: item.patientId, startsAt: item.startsAt, endsAt: item.endsAt, visitType: item.visitType, notes: item.notes })
      notify(overlaps(item) ? 'Visita salvata. Verifica la sovrapposizione evidenziata in agenda.' : item.id ? 'Visita aggiornata.' : 'Visita aggiunta all’agenda.')
      setEditor(null)
    } catch { /* errore globale */ } finally { setSaving(false) }
  }
  function changeStart(value: string) {
    if (!editor) return
    const [oldH, oldM] = editor.start.split(':').map(Number)
    const [endH, endM] = editor.end.split(':').map(Number)
    const [newH, newM] = value.split(':').map(Number)
    const duration = Math.max(30, endH * 60 + endM - oldH * 60 - oldM)
    setEditor({ ...editor, start: value, end: timeValue(Math.min(newH * 60 + newM + duration, 23 * 60 + 59)) })
  }
  async function remove() {
    if (!editor?.id || !window.confirm('Eliminare questo appuntamento?')) return
    try { await workspace.deleteAppointment(editor.id); setEditor(null); notify('Appuntamento eliminato.') } catch { /* errore globale */ }
  }
  function dropTime(day: Date, clientY: number) {
    const column = document.querySelector<HTMLElement>(`[data-agenda-day="${dateKey(day)}"]`)
    if (!column) return 9 * 60
    const rect = column.getBoundingClientRect()
    const raw = START_HOUR * 60 + (clientY - rect.top) / HOUR_HEIGHT * 60
    return Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 30, Math.round(raw / 30) * 30))
  }
  async function drop(event: React.DragEvent, day: Date) {
    event.preventDefault(); event.stopPropagation()
    const item = dragged.current
    if (!item) return
    const duration = Math.round((new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60000)
    const start = Math.min(dropPreview?.day === dateKey(day) ? dropPreview.start : dropTime(day, event.clientY), END_HOUR * 60 - duration)
    const updated = { ...item, startsAt: localIso(day, start), endsAt: localIso(day, start + duration) }
    try { await workspace.updateAppointment(updated); notify(overlaps(updated) ? 'Visita spostata: è presente una sovrapposizione.' : `Visita spostata alle ${timeValue(start)}.`) } catch { /* errore globale */ }
    dragged.current = null; setDragging(null); setDropPreview(null); suppressClick.current = true
  }
  function eventStyle(item: Positioned) {
    const start = minutes(new Date(item.startsAt)); const originalEnd = minutes(new Date(item.endsAt))
    const end = resize?.appointment.id === item.id ? resize.end : originalEnd
    const width = 100 / item.columns
    return { top: `${(start - START_HOUR * 60) / 60 * HOUR_HEIGHT}px`, height: `${Math.max(36, (end - start) / 60 * HOUR_HEIGHT - 4)}px`, left: `calc(${item.column * width}% + 3px)`, width: `calc(${width}% - 7px)` }
  }

  const title = view === 'week' ? `${formatDate(dateKey(days[0]), false)} – ${formatDate(dateKey(days[6]))}` : formatDate(dateKey(days[0]))
  return <>
    <section className="page-heading"><div><span className="eyebrow">AGENDA DELLO STUDIO</span><h1>Calendario</h1><p>Crea, sposta e ridimensiona le visite. Ogni modifica resta collegata al paziente.</p></div><button className="button primary" onClick={() => openNew()}><Plus size={17} />Nuovo appuntamento</button></section>
    <section className="agenda-toolbar panel"><div className="agenda-nav"><button className="icon-button" onClick={() => shift(-1)} aria-label="Periodo precedente"><ChevronLeft size={19} /></button><button className="button secondary compact" onClick={() => setReference(new Date())}>Oggi</button><button className="icon-button" onClick={() => shift(1)} aria-label="Periodo successivo"><ChevronRight size={19} /></button><strong>{title}</strong></div><input aria-label="Vai alla data" type="date" value={dateKey(reference)} onChange={event => { if (event.target.value) setReference(new Date(`${event.target.value}T12:00:00`)) }} /><div className="agenda-view-switch"><button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Settimana</button><button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>Giorno</button><button className={view === 'agenda' ? 'active' : ''} onClick={() => setView('agenda')}>Agenda</button></div></section>
    <p className="agenda-hint"><GripVertical size={14} />Trascina una visita per spostarla; trascina il bordo inferiore per cambiarne la durata. Clicca uno spazio libero per crearne una.</p>
    {view !== 'agenda' && <section className="agenda-shell panel"><div className="agenda-day-headers"><div />{days.map(day => <button key={dateKey(day)} className={dateKey(day) === todayKey() ? 'today' : ''} onClick={() => { setReference(day); setView('day') }}><span>{view === 'week' ? DAY_SHORT[(day.getDay() + 6) % 7] : DAY_SHORT[(day.getDay() + 6) % 7]}</span><strong>{day.getDate()}</strong><small>{day.toLocaleDateString('it-IT', { month: 'short' })}</small></button>)}</div><div className="agenda-scroll"><div className="agenda-time-gutter">{Array.from({ length: END_HOUR - START_HOUR }, (_, index) => <span key={index} style={{ height: HOUR_HEIGHT }}>{pad(index + START_HOUR)}:00</span>)}</div><div className="agenda-columns" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(${view === 'week' ? '120px' : 'min(100%, 700px)'}, 1fr))` }}>{days.map(day => { const key = dateKey(day); const items = layoutDay(workspace.appointments.filter(item => appointmentDateKey(item.startsAt) === key)); return <div className="agenda-day-column" data-agenda-day={key} key={key} style={{ height: TOTAL_HEIGHT }} onClick={event => { if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('agenda-slot-line')) { const start = dropTime(day, event.clientY); openNew(day, start) } }} onDragOver={event => { if (!dragged.current) return; event.preventDefault(); const duration = Math.round((new Date(dragged.current.endsAt).getTime() - new Date(dragged.current.startsAt).getTime()) / 60000); setDropPreview({ day: key, start: Math.min(dropTime(day, event.clientY), END_HOUR * 60 - duration), duration }) }} onDrop={event => void drop(event, day)}>{Array.from({ length: (END_HOUR - START_HOUR) * 2 }, (_, index) => <i className="agenda-slot-line" key={index} style={{ top: index * HOUR_HEIGHT / 2 }} />)}{dropPreview?.day === key && <div className="agenda-drop-preview" style={{ top: (dropPreview.start - START_HOUR * 60) / 60 * HOUR_HEIGHT, height: dropPreview.duration / 60 * HOUR_HEIGHT }}>{timeValue(dropPreview.start)}</div>}{items.map(item => { const patient = workspace.patients.find(candidate => candidate.id === item.patientId); const conflict = overlaps(item); return <article key={item.id} data-appointment-id={item.id} tabIndex={0} role="button" aria-label={`${patient?.name ?? 'Studio'}, ${item.visitType}, ${formatTime(item.startsAt)}`} className={`agenda-event ${dragging === item.id ? 'dragging' : ''} ${conflict ? 'conflict' : ''}`} style={eventStyle(item)} draggable onDragStart={event => { dragged.current = item; setDragging(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id) }} onDragEnd={() => { dragged.current = null; setDragging(null); setDropPreview(null) }} onClick={() => openEdit(item)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openEdit(item) }}><strong>{patient?.name ?? 'Studio'}</strong><span>{formatTime(item.startsAt)} – {formatTime(item.endsAt)}</span><small>{item.visitType}</small><i className="agenda-resize-handle" title="Ridimensiona visita" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); setResize({ appointment: item, startY: event.clientY, end: minutes(new Date(item.endsAt)) }) }} /></article>})}{key === todayKey() && nowTop >= 0 && nowTop <= TOTAL_HEIGHT && <div className="agenda-now" style={{ top: nowTop }}><i /></div>}</div> })}</div></div></section>}
    <section className="panel agenda-list-view"><div className="panel-header"><div><h2>{view === 'agenda' ? 'Prossimi appuntamenti' : 'Agenda compatta'}</h2><p>Alternativa rapida per schermi piccoli e navigazione da tastiera</p></div><span className="badge neutral">{rangeAppointments.length} visite</span></div>{rangeAppointments.length ? [...rangeAppointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map(item => { const patient = workspace.patients.find(candidate => candidate.id === item.patientId); return <article key={item.id}><button className="agenda-list-main" onClick={() => openEdit(item)}><span className="agenda-list-date"><strong>{new Date(item.startsAt).getDate()}</strong><small>{new Date(item.startsAt).toLocaleDateString('it-IT', { month: 'short' })}</small></span>{patient ? <PatientAvatar patient={patient} /> : <span className="avatar soft"><CalendarDays size={17} /></span>}<div><strong>{patient?.name ?? 'Impegno di studio'}</strong><span>{formatTime(item.startsAt)} – {formatTime(item.endsAt)} · {item.visitType}</span></div><ArrowRight size={16} /></button><div className="agenda-list-actions">{patient && <button className="icon-button" title="Apri cartella paziente" onClick={() => onSelectPatient(patient.id)}><UserRound size={16} /></button>}{patient && <button className="icon-button" title="Prepara documento" onClick={() => onBill(item)}><ReceiptText size={16} /></button>}</div></article> }) : <EmptyState icon={<CalendarDays size={27} />} title="Nessun appuntamento nel periodo" text="Clicca su un orario libero oppure usa Nuovo appuntamento." />}</section>
    {editor && <Modal title={editor.id ? 'Modifica visita' : 'Nuovo appuntamento'} description="Orario, durata e prestazione restano modificabili in qualsiasi momento." onClose={() => setEditor(null)}><form className="form-grid" onSubmit={saveEditor}><Field label="Paziente" full><select name="patientId" value={editor.patientId} onChange={event => setEditor({ ...editor, patientId: event.target.value })}><option value="">Impegno di studio</option>{workspace.patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></Field><Field label="Prestazione / visita" full><select name="visitType" value={editor.visitType} onChange={event => { const service = workspace.services.find(item => item.name === event.target.value); const [h, m] = editor.start.split(':').map(Number); setEditor({ ...editor, visitType: event.target.value, end: service ? timeValue(Math.min(h * 60 + m + service.duration, 23 * 60 + 59)) : editor.end }) }}>{!workspace.services.some(service => service.name === editor.visitType) && <option>{editor.visitType}</option>}{workspace.services.filter(service => service.active).map(service => <option key={service.id}>{service.name}</option>)}<option>Prima visita</option><option>Visita di controllo</option><option>Revisione piano</option><option>Follow-up telefonico</option><option>Altro impegno</option></select></Field><Field label="Data"><input name="date" type="date" required value={editor.date} onChange={event => setEditor({ ...editor, date: event.target.value })} /></Field><span /><Field label="Inizio"><input name="time" type="time" step="900" required value={editor.start} onChange={event => changeStart(event.target.value)} /></Field><Field label="Fine"><input name="end" type="time" step="900" required value={editor.end} onChange={event => setEditor({ ...editor, end: event.target.value })} /></Field><Field label="Note" full><textarea name="notes" rows={3} value={editor.notes} onChange={event => setEditor({ ...editor, notes: event.target.value })} placeholder="Obiettivo dell’incontro, esami da portare…" /></Field>{editor.id && overlaps(fromEditor(editor)) && <p className="form-warning full">Questo orario si sovrappone a un altro appuntamento. Puoi salvarlo, ma verifica l’agenda.</p>}<div className="modal-form-actions full">{editor.id && <button className="button secondary danger-text" type="button" onClick={() => void remove()}><Trash2 size={15} />Elimina</button>}{editor.id && editor.patientId && <button className="button secondary" type="button" onClick={() => onBill(fromEditor(editor))}><ReceiptText size={15} />Fattura visita</button>}<span /><button className="button secondary" type="button" onClick={() => setEditor(null)}>Annulla</button><button className="button primary" type="submit" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva appuntamento'}</button></div></form></Modal>}
  </>
}
