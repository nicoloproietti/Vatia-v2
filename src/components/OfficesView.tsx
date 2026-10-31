import { useState } from 'react'
import { AlertCircle, Building2, CalendarDays, Clock3, Mail, MapPin, Pencil, Phone, Plus, Trash2 } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import { todayKey, uid } from '../lib/clinical'
import type { Office } from '../types'
import { DAY_SHORT } from '../types'
import { EmptyState, Field, Modal } from './UI'

const emptyOffice = (): Office => ({ id: uid(), name: '', address: '', city: '', postalCode: '', province: '', email: '', phone: '', color: '#0f8f80', openTime: '08:00', closeTime: '19:00', workDays: [1, 2, 3, 4, 5], active: true })
const fullAddress = (office: Office) => [office.address, `${office.postalCode} ${office.city} ${office.province}`.trim()].filter(Boolean).join(' · ')

export default function OfficesView({ workspace, onOpenAgenda, notify }: { workspace: Workspace; onOpenAgenda: (officeId: string) => void; notify: (message: string) => void }) {
  const [editor, setEditor] = useState<Office | null>(null)
  const active = workspace.offices.filter(office => office.active)
  const upcoming = workspace.appointments.filter(appointment => appointment.startsAt.slice(0, 10) >= todayKey())

  async function remove(office: Office) {
    if (workspace.appointments.some(appointment => appointment.officeId === office.id)) {
      notify('Questa sede è collegata ad appuntamenti: archiviala invece di eliminarla per conservare lo storico.')
      return
    }
    if (!window.confirm(`Eliminare ${office.name}?`)) return
    try { await workspace.deleteOffice(office.id); notify('Sede eliminata.') } catch { /* errore globale */ }
  }

  return <>
    <section className="page-heading"><div><span className="eyebrow">ORGANIZZAZIONE DELLO STUDIO</span><h1>Sedi e disponibilità</h1><p>Un unico studio, anche quando lavori in più uffici.</p></div><button className="button primary" onClick={() => setEditor(emptyOffice())}><Plus size={17} />Nuova sede</button></section>
    {workspace.officeWarning && <div className="billing-warning"><AlertCircle size={17} /><span>{workspace.officeWarning}</span></div>}
    <section className="stats-grid office-stats"><article className="stat-card"><div className="stat-icon"><Building2 size={20} /></div><span>Sedi operative</span><strong>{active.length}</strong><small>{workspace.offices.length - active.length} archiviate</small></article><article className="stat-card"><div className="stat-icon"><MapPin size={20} /></div><span>Città servite</span><strong>{new Set(active.map(office => office.city.trim().toLocaleLowerCase()).filter(Boolean)).size}</strong><small>Indirizzi sempre collegati alle visite</small></article><article className="stat-card"><div className="stat-icon"><CalendarDays size={20} /></div><span>Visite future</span><strong>{upcoming.length}</strong><small>{upcoming.filter(item => item.officeId).length} con sede assegnata</small></article><article className="stat-card"><div className="stat-icon"><Clock3 size={20} /></div><span>Disponibilità</span><strong>{active.reduce((sum, office) => sum + office.workDays.length, 0)}</strong><small>Giornate di apertura configurate</small></article></section>
    {workspace.offices.length ? <div className="office-grid">{workspace.offices.map(office => {
      const count = upcoming.filter(appointment => appointment.officeId === office.id).length
      return <article className={`panel office-card ${office.active ? '' : 'archived'}`} key={office.id} style={{ '--office-color': office.color } as React.CSSProperties}>
        <div className="office-card-accent" />
        <div className="office-card-head"><span className="office-icon"><Building2 size={21} /></span><span className={`badge ${office.active ? 'success' : 'neutral'}`}>{office.active ? 'Operativa' : 'Archiviata'}</span></div>
        <h2>{office.name}</h2><p className="office-address"><MapPin size={15} />{fullAddress(office) || 'Indirizzo da completare'}</p>
        <div className="office-hours"><Clock3 size={16} /><div><strong>{office.openTime}–{office.closeTime}</strong><span>{office.workDays.length ? office.workDays.map(day => DAY_SHORT[day - 1]).join(' · ') : 'Nessun giorno configurato'}</span></div></div>
        {(office.phone || office.email) && <div className="office-contacts">{office.phone && <span><Phone size={13} />{office.phone}</span>}{office.email && <span><Mail size={13} />{office.email}</span>}</div>}
        <div className="office-card-footer"><span>{count} {count === 1 ? 'visita futura' : 'visite future'}</span><button className="text-button" onClick={() => onOpenAgenda(office.id)}>Apri agenda<CalendarDays size={14} /></button></div>
        <div className="office-card-actions"><button className="button secondary" onClick={() => setEditor(office)}><Pencil size={14} />Modifica</button><button className="icon-button danger" title="Elimina sede" onClick={() => void remove(office)}><Trash2 size={15} /></button></div>
      </article>
    })}</div> : <section className="panel"><EmptyState icon={<Building2 size={31} />} title="Configura il primo ufficio" text="Aggiungi indirizzo, contatti, giorni e orari: li ritroverai automaticamente nella creazione delle visite." action={<button className="button primary" onClick={() => setEditor(emptyOffice())}><Plus size={16} />Aggiungi sede</button>} /></section>}
    {editor && <OfficeEditor initial={editor} workspace={workspace} onClose={() => setEditor(null)} notify={notify} />}
  </>
}

function OfficeEditor({ initial, workspace, onClose, notify }: { initial: Office; workspace: Workspace; onClose: () => void; notify: (message: string) => void }) {
  const [office, setOffice] = useState({ ...initial, workDays: [...initial.workDays] })
  const [saving, setSaving] = useState(false)
  const existing = workspace.offices.some(item => item.id === initial.id)

  function toggleDay(day: number) {
    const workDays = office.workDays.includes(day) ? office.workDays.filter(item => item !== day) : [...office.workDays, day].sort()
    setOffice({ ...office, workDays })
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!office.workDays.length && office.active) { notify('Seleziona almeno un giorno di apertura oppure archivia la sede.'); return }
    if (office.active && office.closeTime <= office.openTime) { notify('L’orario di chiusura deve essere successivo all’apertura.'); return }
    setSaving(true)
    try { await workspace.saveOffice(office); notify(existing ? 'Sede aggiornata.' : 'Sede aggiunta: ora è disponibile in agenda.'); onClose() } catch { /* errore globale */ } finally { setSaving(false) }
  }

  return <Modal title={existing ? `Modifica ${initial.name}` : 'Nuova sede'} description="Questi dati alimentano agenda, disponibilità e indicazioni per il paziente." onClose={onClose} wide><form onSubmit={save} className="office-editor">
    <div className="form-grid"><Field label="Nome sede" full><input name="officeName" autoFocus required value={office.name} onChange={event => setOffice({ ...office, name: event.target.value })} placeholder="Es. Studio Centro" /></Field><Field label="Indirizzo" full><input name="officeAddress" required value={office.address} onChange={event => setOffice({ ...office, address: event.target.value })} placeholder="Via, numero civico" /></Field><Field label="CAP"><input required maxLength={5} value={office.postalCode} onChange={event => setOffice({ ...office, postalCode: event.target.value })} /></Field><Field label="Città"><input required value={office.city} onChange={event => setOffice({ ...office, city: event.target.value })} /></Field><Field label="Provincia"><input required maxLength={2} value={office.province} onChange={event => setOffice({ ...office, province: event.target.value.toUpperCase() })} /></Field><Field label="Telefono"><input type="tel" value={office.phone} onChange={event => setOffice({ ...office, phone: event.target.value })} /></Field><Field label="Email" full><input type="email" value={office.email} onChange={event => setOffice({ ...office, email: event.target.value })} /></Field><Field label="Apertura"><input type="time" required value={office.openTime} onChange={event => setOffice({ ...office, openTime: event.target.value })} /></Field><Field label="Chiusura"><input type="time" required value={office.closeTime} onChange={event => setOffice({ ...office, closeTime: event.target.value })} /></Field><Field label="Colore in agenda"><input className="office-color-input" type="color" value={office.color} onChange={event => setOffice({ ...office, color: event.target.value })} /></Field><Field label="Stato"><select value={office.active ? 'active' : 'archived'} onChange={event => setOffice({ ...office, active: event.target.value === 'active' })}><option value="active">Operativa</option><option value="archived">Archiviata</option></select></Field></div>
    <fieldset className="office-days"><legend>Giorni di apertura</legend><div>{DAY_SHORT.map((day, index) => <label key={day}><input type="checkbox" checked={office.workDays.includes(index + 1)} onChange={() => toggleDay(index + 1)} /><span>{day}</span></label>)}</div></fieldset>
    <div className="modal-form-actions"><button type="button" className="button secondary" onClick={onClose}>Annulla</button><span /><button className="button primary" type="submit" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva sede'}</button></div>
  </form></Modal>
}
