import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, Banknote, BookOpen, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Columns3, EyeOff, GripVertical, Plus, ReceiptText, RotateCcw, Settings2, Sparkles, Trash2, UserRound, Users, Utensils } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import { activePlanFor, appointmentDateKey, formatDate, formatTime, formatToday, todayKey } from '../lib/clinical'
import { buildOnboardingChecklist, persistOnboardingDismissed, readOnboardingDismissed } from '../lib/onboarding'
import type { OnboardingStepId } from '../lib/onboarding'
import type { Appointment, Page } from '../types'
import { EmptyState, PatientAvatar } from './UI'
import GoogleAccountConnection from './GoogleAccountConnection'
import OnboardingChecklist from './OnboardingChecklist'
import VatiaBuddy from './VatiaBuddy'

const money = (value: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
const total = (invoice: Workspace['invoices'][number]) => invoice.amount * (invoice.enpab ? 1.04 : 1) + (invoice.stamp ? 2 : 0)

type WidgetId = 'onboarding' | 'visits' | 'patients' | 'actions' | 'receivables' | 'schedule' | 'attention' | 'paths' | 'shortcuts'
type WidgetSize = 'small' | 'medium' | 'large' | 'full'
type WidgetConfig = { id: WidgetId; size: WidgetSize; visible: boolean }

const WIDGET_NAMES: Record<WidgetId, string> = {
  onboarding: 'Avvio guidato', visits: 'Visite di oggi', patients: 'Pazienti attivi', actions: 'Azioni aperte', receivables: 'Da incassare',
  schedule: 'La tua giornata', attention: 'Richiede attenzione', paths: 'Continuità dei percorsi', shortcuts: 'Azioni rapide',
}
const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: 'onboarding', size: 'full', visible: true },
  { id: 'visits', size: 'small', visible: true }, { id: 'patients', size: 'small', visible: true },
  { id: 'actions', size: 'small', visible: true }, { id: 'receivables', size: 'small', visible: true },
  { id: 'schedule', size: 'medium', visible: true }, { id: 'attention', size: 'medium', visible: true },
  { id: 'paths', size: 'large', visible: true }, { id: 'shortcuts', size: 'small', visible: true },
]
const SIZES: WidgetSize[] = ['small', 'medium', 'large', 'full']

function readLayout(owner: string): WidgetConfig[] {
  try {
    const stored = JSON.parse(localStorage.getItem(`vatia-dashboard-${owner}`) ?? '[]') as WidgetConfig[]
    const valid = stored.filter(item => item && item.id in WIDGET_NAMES && SIZES.includes(item.size)).map(item => ({ ...item, visible: item.visible !== false }))
    const missing = DEFAULT_LAYOUT.filter(item => !valid.some(candidate => candidate.id === item.id))
    const onboarding = missing.find(item => item.id === 'onboarding')
    const merged = onboarding ? [onboarding, ...valid, ...missing.filter(item => item.id !== 'onboarding')] : [...valid, ...missing]
    return merged.map(item => ({ ...item }))
  } catch { return DEFAULT_LAYOUT.map(item => ({ ...item })) }
}

export default function DashboardCenter({ workspace, session, userName, layoutOwner, navigate, notify, onSelectPatient, onNewPatient, onImportPatients, onNewDiet, onOpenBilling, onLoadDemo, onClearDemo }: { workspace: Workspace; session: Session | null; userName: string; layoutOwner: string; navigate: (page: Page) => void; notify: (message: string) => void; onSelectPatient: (id: string) => void; onNewPatient: () => void; onImportPatients: () => void; onNewDiet: (patientId?: string) => void; onOpenBilling: (tab: 'settings' | 'services') => void; onLoadDemo?: () => void; onClearDemo?: () => void }) {
  const [layout, setLayout] = useState<WidgetConfig[]>(() => readLayout(layoutOwner))
  const [editing, setEditing] = useState(false)
  const [officeId, setOfficeId] = useState('all')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => readOnboardingDismissed(layoutOwner, localStorage))
  const dragged = useRef<WidgetId | null>(null)
  const today = todayKey()
  const effectiveOfficeId = officeId !== 'all' && workspace.offices.some(office => office.id === officeId && office.active) ? officeId : 'all'
  const scopedAppointments = workspace.appointments.filter(item => effectiveOfficeId === 'all' || item.officeId === effectiveOfficeId)
  const appointments = scopedAppointments.filter(item => appointmentDateKey(item.startsAt) === today).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const activePatients = workspace.patients.filter(patient => patient.status !== 'Archiviato')
  const tasks = workspace.notes.filter(note => note.kind === 'Attività' && !note.done)
  const drafts = workspace.plans.filter(plan => plan.status === 'Bozza')
  const receivables = workspace.invoices.filter(invoice => invoice.status === 'Emessa')
  const missingDiary = activePatients.filter(patient => !workspace.diary.some(entry => entry.patientId === patient.id && entry.date >= (() => { const date = new Date(); date.setDate(date.getDate() - 6); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` })()))
  const hasDemo = workspace.patients.some(item => item.id.startsWith('demo-'))
  const onboardingSteps = buildOnboardingChecklist({ cloud: Boolean(session), billingSettings: workspace.billingSettings, officeCount: workspace.offices.filter(office => office.active).length, serviceCount: workspace.services.filter(service => service.active).length, calendarConnected, patientCount: workspace.patients.length, dietCount: workspace.plans.length, inviteCount: workspace.patientInvites.length })
  const visible = layout.filter(item => item.visible && (item.id !== 'onboarding' || !onboardingDismissed))
  const officeName = (appointment: Appointment) => workspace.offices.find(office => office.id === appointment.officeId)?.name

  useEffect(() => { localStorage.setItem(`vatia-dashboard-${layoutOwner}`, JSON.stringify(layout)) }, [layout, layoutOwner])

  function update(id: WidgetId, change: Partial<WidgetConfig>) { setLayout(current => current.map(item => item.id === id ? { ...item, ...change } : item)) }
  function resize(id: WidgetId) {
    const item = layout.find(candidate => candidate.id === id)
    if (item) update(id, { size: SIZES[(SIZES.indexOf(item.size) + 1) % SIZES.length] })
  }
  function move(id: WidgetId, direction: number) {
    setLayout(current => {
      const index = current.findIndex(item => item.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]; const [item] = next.splice(index, 1); next.splice(target, 0, item); return next
    })
  }
  function reorder(target: WidgetId) {
    const source = dragged.current
    if (!source || source === target) return
    setLayout(current => {
      const next = [...current]; const sourceIndex = next.findIndex(item => item.id === source); const targetIndex = next.findIndex(item => item.id === target)
      const [item] = next.splice(sourceIndex, 1); next.splice(targetIndex, 0, item); return next
    })
    dragged.current = null
  }

  const onboardingActions: Partial<Record<OnboardingStepId, () => void>> = {
    studio: () => onOpenBilling('settings'),
    office: () => navigate('sedi'),
    services: () => onOpenBilling('services'),
    patient: onNewPatient,
    diet: () => onNewDiet(activePatients[0]?.id),
    invite: () => {
      const patient = activePatients.find(item => item.email) ?? activePatients[0]
      if (patient) { onSelectPatient(patient.id); navigate('pazienti') } else onNewPatient()
    },
  }
  function dismissOnboarding() {
    persistOnboardingDismissed(layoutOwner, localStorage)
    setOnboardingDismissed(true)
  }
  const onboarding = <OnboardingChecklist steps={onboardingSteps} actions={onboardingActions} onImport={onImportPatients} onDismiss={dismissOnboarding} googleConnection={<GoogleAccountConnection session={session} appointments={workspace.appointments} reload={workspace.reload} notify={notify} onStatusChange={setCalendarConnected} />} />

  const widgets: Record<WidgetId, React.ReactNode> = {
    onboarding,
    visits: <article className="stat-card"><div className="stat-icon"><CalendarDays size={20} /></div><span>Visite di oggi</span><strong>{appointments.length}</strong><small>{appointments[0] ? `Prossima alle ${formatTime(appointments[0].startsAt)}` : 'Agenda libera'}</small></article>,
    patients: <article className="stat-card"><div className="stat-icon"><Users size={20} /></div><span>Pazienti attivi</span><strong>{activePatients.length}</strong><small>{missingDiary.length} senza dati recenti</small></article>,
    actions: <article className="stat-card"><div className="stat-icon"><CheckCircle2 size={20} /></div><span>Azioni aperte</span><strong>{tasks.length + drafts.length}</strong><small>{tasks.length} follow-up · {drafts.length} bozze</small></article>,
    receivables: <article className="stat-card"><div className="stat-icon"><Banknote size={20} /></div><span>Da incassare</span><strong>{money(receivables.reduce((sum, invoice) => sum + total(invoice), 0))}</strong><small>{receivables.length} documenti emessi</small></article>,
    schedule: <section className="panel schedule-panel"><div className="panel-header"><div><h2>La tua giornata</h2><p>Agenda e ingresso rapido nelle cartelle</p></div><button className="text-button" onClick={() => navigate('calendario')}>Apri agenda<ArrowRight size={13} /></button></div>{appointments.length ? <div className="command-appointments">{appointments.map(item => { const patient = workspace.patients.find(candidate => candidate.id === item.patientId); return <button key={item.id} onClick={() => { if (patient) { onSelectPatient(patient.id); navigate('pazienti') } else navigate('calendario') }}><span className="command-time">{formatTime(item.startsAt)}</span>{patient ? <PatientAvatar patient={patient} /> : <span className="avatar soft"><Clock3 size={16} /></span>}<div><strong>{patient?.name ?? 'Impegno di studio'}</strong><span>{item.visitType} · {Math.round((new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60000)} min{officeName(item) ? ` · ${officeName(item)}` : ''}</span></div><ArrowRight size={16} /></button> })}</div> : <EmptyState icon={<CalendarDays size={26} />} title="Nessuna visita oggi" text={effectiveOfficeId === 'all' ? 'Crea un appuntamento o trascina quelli esistenti nella nuova agenda.' : 'Nessuna visita in questa sede. Cambia filtro oppure pianificane una.'} action={<button className="text-button" onClick={() => navigate('calendario')}>Pianifica ora</button>} />}</section>,
    attention: <section className="panel command-next"><div className="panel-header"><div><h2>Richiede attenzione</h2><p>Una coda operativa, non semplici notifiche</p></div><Sparkles size={18} /></div><div className="command-queue">{tasks.slice(0, 3).map(task => <button key={task.id} onClick={() => { onSelectPatient(task.patientId); navigate('pazienti') }}><span className="queue-icon"><UserRound size={16} /></span><div><strong>{task.text}</strong><span>{workspace.patients.find(item => item.id === task.patientId)?.name}{task.dueDate ? ` · ${formatDate(task.dueDate)}` : ''}</span></div></button>)}{drafts.slice(0, 2).map(plan => <button key={plan.id} onClick={() => navigate('diete')}><span className="queue-icon"><BookOpen size={16} /></span><div><strong>Completa {plan.name}</strong><span>{workspace.patients.find(item => item.id === plan.patientId)?.name}</span></div></button>)}{receivables.slice(0, 2).map(invoice => <button key={invoice.id} onClick={() => navigate('fatture')}><span className="queue-icon"><ReceiptText size={16} /></span><div><strong>Incassa {money(total(invoice))}</strong><span>{invoice.number} · {workspace.patients.find(item => item.id === invoice.patientId)?.name}</span></div></button>)}{!tasks.length && !drafts.length && !receivables.length && <EmptyState icon={<CheckCircle2 size={27} />} title="Sei in pari" text="Non ci sono follow-up, bozze o incassi in sospeso." />}</div></section>,
    paths: <section className="panel command-patients"><div className="panel-header"><div><h2>Continuità dei percorsi</h2><p>Stato del piano e ultimo contatto per paziente</p></div><button className="text-button" onClick={() => navigate('diario')}>Monitoraggio</button></div><div className="command-patient-grid">{activePatients.slice(0, 6).map(patient => { const plan = activePlanFor(workspace.plans, patient.id); const last = workspace.diary.filter(entry => entry.patientId === patient.id).sort((a, b) => b.date.localeCompare(a.date))[0]; return <button key={patient.id} onClick={() => { onSelectPatient(patient.id); navigate('pazienti') }}><PatientAvatar patient={patient} /><strong>{patient.name}</strong><span>{plan ? `${plan.calories} kcal · ${plan.status}` : 'Piano da creare'}</span><small>{last ? `Diario: ${formatDate(last.date, false)}` : 'Nessun dato nel monitoraggio'}</small></button> })}</div></section>,
    shortcuts: <section className="panel command-shortcuts"><div className="panel-header"><div><h2>Azioni rapide</h2><p>I flussi più frequenti, sempre a portata di mano</p></div></div><div><button onClick={onNewPatient}><UserRound size={18} /><span>Nuovo paziente</span><ArrowRight size={14} /></button><button onClick={() => navigate('diete')}><Utensils size={18} /><span>Crea o revisiona una dieta</span><ArrowRight size={14} /></button><button onClick={() => navigate('fatture')}><ReceiptText size={18} /><span>Nuovo documento</span><ArrowRight size={14} /></button></div></section>,
  }

  return <>
    <section className="page-heading"><div><span className="eyebrow">{formatToday(new Date())}</span><h1>Buongiorno, {userName}.</h1><p>Tutto lo studio in una vista: il prossimo passo è sempre chiaro.</p></div><div className="heading-actions">{workspace.offices.some(office => office.active) && <select className="period-select" aria-label="Filtra dashboard per sede" value={effectiveOfficeId} onChange={event => setOfficeId(event.target.value)}><option value="all">Tutte le sedi</option>{workspace.offices.filter(office => office.active).map(office => <option key={office.id} value={office.id}>{office.name}</option>)}</select>}{hasDemo && onClearDemo && <button className="button secondary" onClick={onClearDemo}><Trash2 size={15} />Rimuovi demo</button>}{workspace.patients.length > 0 && <button className={`button ${editing ? 'primary' : 'secondary'}`} onClick={() => setEditing(!editing)}>{editing ? <Check size={16} /> : <Settings2 size={16} />}{editing ? 'Fine' : 'Personalizza'}</button>}<button className="button secondary" onClick={() => navigate('calendario')}><Plus size={16} />Appuntamento</button><button className="button primary" onClick={onNewPatient}><Plus size={16} />Nuovo paziente</button></div></section>
    {!workspace.patients.length ? <>{!onboardingDismissed && onboarding}<section className="panel studio-onboarding"><div><span className="eyebrow">IL TUO STUDIO, SUBITO OPERATIVO</span><h2>Dal primo paziente al follow-up, senza passaggi dispersi.</h2><p>Anagrafica, anamnesi, piano, agenda e amministrazione condividono gli stessi dati. Inizia con un percorso reale oppure esplora una demo completamente modificabile.</p><div className="heading-actions"><button className="button primary" onClick={onNewPatient}>Crea il primo paziente<ArrowRight size={16} /></button>{onLoadDemo && <button className="button secondary" onClick={onLoadDemo}><Sparkles size={16} />Esplora con dati demo</button>}</div></div><div className="buddy-onboarding"><VatiaBuddy size={145} /><span>Sono Vatia. Ti aiuto a tenere tutto in ordine.</span></div></section></> : <>
      {editing && <section className="dashboard-customizer panel"><div><span className="eyebrow">LAYOUT PERSONALE</span><strong>Componi la tua giornata di lavoro</strong><p>Trascina i widget, cambia larghezza oppure usa le frecce. Le modifiche vengono salvate automaticamente.</p></div><div className="dashboard-customizer-actions"><button className="button secondary" onClick={() => setLayout(DEFAULT_LAYOUT.map(item => ({ ...item })))}><RotateCcw size={15} />Ripristina</button><button className="button primary" onClick={() => setEditing(false)}><Check size={15} />Salva e chiudi</button></div>{layout.some(item => !item.visible) && <div className="widget-gallery"><span>Widget nascosti</span>{layout.filter(item => !item.visible).map(item => <button key={item.id} onClick={() => update(item.id, { visible: true })}><Plus size={13} />{WIDGET_NAMES[item.id]}</button>)}</div>}</section>}
      <div className={`modular-dashboard ${editing ? 'is-editing' : ''}`}>
        {visible.map((item, index) => <div key={item.id} data-widget-id={item.id} className={`dashboard-widget widget-${item.size} ${editing ? 'editing' : ''}`} draggable={editing} onDragStart={event => { dragged.current = item.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id) }} onDragOver={event => { if (editing) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={event => { event.preventDefault(); reorder(item.id) }} onDragEnd={() => { dragged.current = null }}>
          {editing && <div className="widget-controls"><GripVertical size={15} /><strong>{WIDGET_NAMES[item.id]}</strong><button className="icon-button" title="Sposta indietro" disabled={index === 0} onClick={() => move(item.id, -1)}><ChevronLeft size={15} /></button><button className="icon-button" title="Sposta avanti" disabled={index === visible.length - 1} onClick={() => move(item.id, 1)}><ChevronRight size={15} /></button><button className="icon-button" title={`Ridimensiona ${WIDGET_NAMES[item.id]}`} onClick={() => resize(item.id)}><Columns3 size={15} /></button><button className="icon-button" title={`Nascondi ${WIDGET_NAMES[item.id]}`} onClick={() => update(item.id, { visible: false })}><EyeOff size={15} /></button></div>}
          {widgets[item.id]}
        </div>)}
      </div>
      {!visible.length && <section className="panel"><EmptyState icon={<Settings2 size={28} />} title="La dashboard è vuota" text="Apri Personalizza e riaggiungi i widget che ti servono." action={<button className="button primary" onClick={() => setEditing(true)}>Personalizza dashboard</button>} /></section>}
    </>}
  </>
}
