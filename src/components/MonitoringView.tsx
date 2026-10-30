import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, Plus, Sparkles, UserRound } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import { activePlanFor, adherenceForDays, appointmentDateKey, dateKey, formatDate, sumNutrients, todayKey } from '../lib/clinical'
import type { Patient } from '../types'
import DiaryView from './DiaryView'
import { EmptyState, PatientAvatar, ProgressBar } from './UI'
import VatiaBuddy from './VatiaBuddy'

function patientWeek(workspace: Workspace, patient: Patient) {
  const plan = activePlanFor(workspace.plans, patient.id)
  const target = plan?.calories ?? patient.calories
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index)); const key = dateKey(date)
    const entries = workspace.diary.filter(entry => entry.patientId === patient.id && entry.date === key)
    const nutrients = sumNutrients(entries.flatMap(entry => {
      const food = workspace.foods.find(item => item.id === entry.foodId)
      return food ? [{ food, grams: entry.grams }] : []
    }))
    return { key, kcal: nutrients.kcal, target, entries: entries.length }
  })
}

export default function MonitoringView({ workspace, onNewDiet, notify }: { workspace: Workspace; onNewDiet: (id: string) => void; notify: (message: string) => void }) {
  const [patientId, setPatientId] = useState('')
  const [filter, setFilter] = useState<'all' | 'attention' | 'missing'>('all')
  const patient = workspace.patients.find(item => item.id === patientId)
  const rows = useMemo(() => workspace.patients.filter(item => item.status !== 'Archiviato').map(item => {
    const week = patientWeek(workspace, item)
    const logged = week.filter(day => day.entries > 0)
    const last = [...workspace.diary].filter(entry => entry.patientId === item.id).sort((a, b) => b.date.localeCompare(a.date))[0]
    const next = workspace.appointments.filter(itemAppointment => itemAppointment.patientId === item.id && appointmentDateKey(itemAppointment.startsAt) >= todayKey()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
    const adherence = adherenceForDays(week)
    return { patient: item, week, logged: logged.length, adherence, last, next, attention: logged.length > 0 && adherence < 70, missing: logged.length < 3 }
  }), [workspace])
  const visible = rows.filter(row => filter === 'all' || (filter === 'attention' ? row.attention : row.missing))
  const average = rows.filter(row => row.logged).length ? Math.round(rows.filter(row => row.logged).reduce((sum, row) => sum + row.adherence, 0) / rows.filter(row => row.logged).length) : 0

  async function prepareFollowUp(id: string) {
    const row = rows.find(item => item.patient.id === id)
    if (!row) return
    try {
      await workspace.addNote({ patientId: id, kind: 'Attività', dueDate: todayKey(), text: `Follow-up: ${row.logged}/7 giorni registrati, aderenza ${row.adherence}%. Verificare contesto e scostamenti prima di modificare il piano.` })
      notify('Follow-up preparato nelle attività del paziente.')
    } catch { /* errore globale */ }
  }

  if (patient) return <>
    <button className="button secondary monitoring-back" onClick={() => setPatientId('')}><ArrowLeft size={16} />Panoramica pazienti</button>
    <DiaryView workspace={workspace} patient={patient} patients={workspace.patients} onSelectPatient={setPatientId} onNewDiet={onNewDiet} notify={notify} detailMode />
  </>

  return <>
    <section className="page-heading"><div><span className="eyebrow">MONITORAGGIO TRASVERSALE</span><h1>Aderenza e follow-up</h1><p>Capisci chi richiede attenzione prima della visita, senza aprire ogni cartella.</p></div><button className="button secondary" onClick={() => setFilter(filter === 'attention' ? 'all' : 'attention')}><Sparkles size={16} />{filter === 'attention' ? 'Mostra tutti' : 'Priorità follow-up'}</button></section>
    <section className="monitoring-explainer panel"><VatiaBuddy size={96} /><div><span className="eyebrow">A COSA SERVE</span><h2>Il diario alimentare diventa una decisione clinica.</h2><p>Il paziente registra ciò che ha consumato; Vatia confronta quei dati con il piano. Tu vedi giorni mancanti, scostamenti e prossimo appuntamento, poi prepari il follow-up con un clic. Non serve a riscrivere la dieta e uno scostamento non è una diagnosi.</p></div><div className="monitoring-flow"><span><BookOpen size={17} />Piano</span><ArrowRight size={15} /><span><ClipboardCheck size={17} />Consumi</span><ArrowRight size={15} /><span><UserRound size={17} />Follow-up</span></div></section>
    {rows.length ? <>
      <section className="stats-grid"><article className="stat-card"><div className="stat-icon"><UserRound size={20} /></div><span>Pazienti monitorati</span><strong>{rows.length}</strong><small>{rows.filter(row => row.logged > 0).length} con dati recenti</small></article><article className="stat-card"><div className="stat-icon"><CheckCircle2 size={20} /></div><span>Aderenza media</span><strong>{rows.some(row => row.logged) ? `${average}%` : '—'}</strong><small>Solo giorni effettivamente registrati</small></article><article className="stat-card"><div className="stat-icon"><Sparkles size={20} /></div><span>Da approfondire</span><strong>{rows.filter(row => row.attention).length}</strong><small>Aderenza sotto il 70%</small></article><article className="stat-card"><div className="stat-icon"><CalendarClock size={20} /></div><span>Dati insufficienti</span><strong>{rows.filter(row => row.missing).length}</strong><small>Meno di 3 giorni registrati</small></article></section>
      <div className="record-tabs monitoring-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tutti <b>{rows.length}</b></button><button className={filter === 'attention' ? 'active' : ''} onClick={() => setFilter('attention')}>Da approfondire <b>{rows.filter(row => row.attention).length}</b></button><button className={filter === 'missing' ? 'active' : ''} onClick={() => setFilter('missing')}>Dati insufficienti <b>{rows.filter(row => row.missing).length}</b></button></div>
      <section className="panel monitoring-table"><div className="monitoring-table-head"><span>Paziente</span><span>Registrazioni</span><span>Aderenza</span><span>Ultimo aggiornamento</span><span>Prossima visita</span><span>Azione</span></div>{visible.map(row => <article className="monitoring-row" key={row.patient.id}><button className="monitoring-patient" onClick={() => setPatientId(row.patient.id)}><PatientAvatar patient={row.patient} /><div><strong>{row.patient.name}</strong><span>{row.patient.goal}</span></div></button><div className="monitoring-days"><strong>{row.logged} / 7</strong><div>{row.week.map(day => <i key={day.key} className={day.entries ? 'logged' : ''} title={`${formatDate(day.key)}: ${day.entries} registrazioni`} />)}</div></div><div className="monitoring-adherence"><strong>{row.logged ? `${row.adherence}%` : '—'}</strong><ProgressBar value={row.adherence} warning={row.attention} /></div><span>{row.last ? formatDate(row.last.date) : 'Nessun dato'}</span><span>{row.next ? formatDate(appointmentDateKey(row.next.startsAt)) : 'Non programmata'}</span><div className="monitoring-actions"><button className="icon-button" title="Apri il confronto giornaliero" onClick={() => setPatientId(row.patient.id)}><ArrowRight size={16} /></button><button className="button secondary compact" onClick={() => void prepareFollowUp(row.patient.id)}><Plus size={14} />Prepara follow-up</button></div></article>)}{!visible.length && <EmptyState icon={<CheckCircle2 size={28} />} title="Nessun paziente in questa vista" text="Cambia filtro per vedere tutto il monitoraggio." />}</section>
    </> : <section className="panel"><EmptyState icon={<BookOpen size={30} />} title="Il monitoraggio inizia con un percorso" text="Crea un paziente e assegna un piano: qui troverai aderenza e follow-up di tutto lo studio." /></section>}
  </>
}
