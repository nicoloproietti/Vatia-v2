import { useEffect, useState } from 'react'
import { Activity, ArrowRight, BookOpen, CalendarPlus, Check, CheckCircle2, ClipboardList, Copy, FileText, LineChart as LineChartIcon, Mail, NotebookPen, Pencil, Phone, Plus, Ruler, Search, Stethoscope, Target, Users } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Workspace } from '../hooks/useWorkspace'
import type { Anamnesis, DietPlan, Measurement, Patient } from '../types'
import { activePlanFor, ACTIVITY_MULTIPLIERS, adherenceForDays, calculateTDEE, dateKey, formatDate, formatDateTime, macroGrams, todayKey } from '../lib/clinical'
import { EmptyState, Field, Modal, PatientAvatar } from './UI'

type Tab = 'overview' | 'anamnesis' | 'measurements' | 'diets' | 'notes'
const tabs: { id: Tab; label: string }[] = [{ id: 'overview', label: 'Panoramica' }, { id: 'anamnesis', label: 'Anamnesi' }, { id: 'measurements', label: 'Misurazioni' }, { id: 'diets', label: 'Diete' }, { id: 'notes', label: 'Note e attività' }]

type Props = {
  workspace: Workspace
  selectedPatientId: string
  onSelectPatient: (id: string) => void
  onNewPatient: () => void
  onNewDiet: (patientId: string) => void
  onOpenDiet: (plan: DietPlan) => void
  onOpenDiary: (patientId: string) => void
  onNewAppointment: (patientId: string) => void
  notify: (message: string) => void
}

export default function PatientManager({ workspace, selectedPatientId, onSelectPatient, onNewPatient, onNewDiet, onOpenDiet, onOpenDiary, onNewAppointment, notify }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [query, setQuery] = useState('')
  const [measurementOpen, setMeasurementOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const patient = workspace.patients.find(item => item.id === selectedPatientId)
  const filtered = workspace.patients.filter(item => item.name.toLowerCase().includes(query.toLowerCase()))
  const patientPlans = workspace.plans.filter(plan => plan.patientId === selectedPatientId)
  const patientMeasurements = workspace.measurements.filter(item => item.patientId === selectedPatientId)
  const patientNotes = workspace.notes.filter(item => item.patientId === selectedPatientId)

  if (!workspace.patients.length) return <section className="panel"><EmptyState icon={<Users size={32} />} title="Il tuo studio è pronto" text="Crea il primo paziente: Vatia calcolerà il fabbisogno e preparerà il percorso senza dati dimostrativi." action={<button className="button primary" onClick={onNewPatient}><Plus size={16} />Crea il primo paziente</button>} /></section>

  return <>
    <section className="page-heading"><div><span className="eyebrow">GESTIONE STUDIO</span><h1>Pazienti</h1><p>Tutto il percorso clinico, dalla prima visita al follow-up.</p></div><button className="button primary" onClick={onNewPatient}><Plus size={17} />Nuovo paziente</button></section>
    <div className="patient-workspace">
      <aside className="panel patient-directory"><div className="search-field"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca paziente…" aria-label="Cerca paziente" /></div><div className="directory-count">{filtered.length} {filtered.length === 1 ? 'paziente' : 'pazienti'}</div><div className="directory-list">{filtered.map(item => <button key={item.id} className={item.id === selectedPatientId ? 'active' : ''} onClick={() => { onSelectPatient(item.id); setTab('overview') }}><PatientAvatar patient={item} /><div><strong>{item.name}</strong><span>{item.goal || 'Obiettivo da definire'}</span></div><ArrowRight size={14} /></button>)}</div></aside>
      {patient && <section className="patient-record">
        <div className="panel patient-record-header"><PatientAvatar patient={patient} large /><div className="patient-identity"><div><h2>{patient.name}</h2><span className={`badge ${patient.status === 'Attivo' ? 'success' : 'neutral'}`}>{patient.status}</span></div><p>{patient.age} anni · {patient.goal || 'Obiettivo da definire'}</p><div className="patient-contacts">{patient.email && <span><Mail size={13} />{patient.email}</span>}{patient.phone && <span><Phone size={13} />{patient.phone}</span>}</div></div><div className="record-actions"><button className="button secondary" onClick={() => setEditOpen(true)}><Pencil size={15} />Modifica</button><button className="button primary" onClick={() => onNewDiet(patient.id)}><Plus size={16} />Nuova dieta</button></div></div>
        <div className="record-tabs" role="tablist">{tabs.map(item => <button role="tab" aria-selected={tab === item.id} key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}{item.id === 'diets' && <b>{patientPlans.length}</b>}{item.id === 'notes' && <b>{patientNotes.filter(note => !note.done).length}</b>}</button>)}</div>
        {tab === 'overview' && <Overview patient={patient} workspace={workspace} onTab={setTab} onNewDiet={onNewDiet} onOpenDiet={onOpenDiet} onOpenDiary={onOpenDiary} onNewAppointment={onNewAppointment} />}
        {tab === 'anamnesis' && <AnamnesisForm patient={patient} workspace={workspace} notify={notify} />}
        {tab === 'measurements' && <Measurements patient={patient} measurements={patientMeasurements} onAdd={() => setMeasurementOpen(true)} />}
        {tab === 'diets' && <PatientDiets plans={patientPlans} workspace={workspace} onNewDiet={onNewDiet} onOpenDiet={onOpenDiet} notify={notify} />}
        {tab === 'notes' && <PatientNotes patient={patient} workspace={workspace} notify={notify} />}
      </section>}
    </div>
    {patient && measurementOpen && <MeasurementModal patient={patient} workspace={workspace} onClose={() => setMeasurementOpen(false)} notify={notify} />}
    {patient && editOpen && <EditPatientModal patient={patient} workspace={workspace} onClose={() => setEditOpen(false)} notify={notify} />}
  </>
}

function Overview({ patient, workspace, onTab, onNewDiet, onOpenDiet, onOpenDiary, onNewAppointment }: { patient: Patient; workspace: Workspace; onTab: (tab: Tab) => void; onNewDiet: (id: string) => void; onOpenDiet: (plan: DietPlan) => void; onOpenDiary: (id: string) => void; onNewAppointment: (id: string) => void }) {
  const tdee = calculateTDEE(patient)
  const activePlan = activePlanFor(workspace.plans, patient.id)
  const lastMeasurement = workspace.measurements.filter(item => item.patientId === patient.id).sort((a, b) => b.date.localeCompare(a.date))[0]
  const nextAppointment = workspace.appointments.filter(item => item.patientId === patient.id && item.startsAt >= new Date().toISOString()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
  const anamnesisComplete = Object.values(patient.anamnesis).some(value => value.trim() && !['Onnivora', '0', 'No', 'Moderato'].includes(value))
  const nextAction = !anamnesisComplete ? { title: 'Completa l’anamnesi', text: 'Allergie, farmaci e abitudini rendono il piano più sicuro e personale.', action: () => onTab('anamnesis'), label: 'Apri anamnesi' } : !activePlan ? { title: 'Costruisci il primo piano', text: 'Fabbisogno e misure sono già pronti nel builder.', action: () => onNewDiet(patient.id), label: 'Prepara dieta' } : { title: 'Controlla l’aderenza', text: 'Confronta il diario con il piano e prepara il prossimo follow-up.', action: () => onOpenDiary(patient.id), label: 'Apri diario' }
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index)); const key = dateKey(date)
    const entries = workspace.diary.filter(item => item.patientId === patient.id && item.date === key)
    return { key, entries: entries.length, kcal: 0, target: patient.calories }
  })
  const loggedDays = week.filter(day => day.entries > 0).length
  return <div className="record-content overview-grid">
    <section className="panel next-action"><div className="next-action-icon"><Target size={22} /></div><div><span className="eyebrow">PROSSIMO PASSO CONSIGLIATO</span><h3>{nextAction.title}</h3><p>{nextAction.text}</p></div><button className="button primary" onClick={nextAction.action}>{nextAction.label}<ArrowRight size={15} /></button></section>
    <section className="panel clinical-metrics"><div><span><Activity size={15} />Fabbisogno stimato</span><strong>{tdee || '—'} <small>kcal</small></strong><p>Target piano: {patient.calories || '—'} kcal</p></div><div><span><Ruler size={15} />Ultimo peso</span><strong>{lastMeasurement?.weight || patient.weight || '—'} <small>kg</small></strong><p>{lastMeasurement ? formatDate(lastMeasurement.date) : 'Nessuna misurazione'}</p></div><div><span><BookOpen size={15} />Piano attivo</span><button className="metric-text metric-link" disabled={!activePlan} onClick={() => activePlan && onOpenDiet(activePlan)}>{activePlan?.name ?? 'Non creato'}</button><p>{activePlan?.status ?? 'Inizia dal builder'}</p></div><div><span><CheckCircle2 size={15} />Diario · 7 giorni</span><strong>{loggedDays}<small> / 7 giorni</small></strong><p>{loggedDays ? `${adherenceForDays(week)}% nei target` : 'Nessuna registrazione'}</p></div></section>
    <section className="panel overview-detail"><div className="panel-header"><div><h2>Contesto clinico</h2><p>Informazioni essenziali prima della prescrizione</p></div><button className="text-button" onClick={() => onTab('anamnesis')}>Modifica</button></div><dl><div><dt>Allergie</dt><dd>{patient.anamnesis.allergies || 'Non registrate'}</dd></div><div><dt>Intolleranze</dt><dd>{patient.anamnesis.intolerances || 'Non registrate'}</dd></div><div><dt>Patologie</dt><dd>{patient.anamnesis.conditions || 'Non registrate'}</dd></div><div><dt>Farmaci</dt><dd>{patient.anamnesis.medications || 'Non registrati'}</dd></div><div><dt>Alimentazione</dt><dd>{patient.anamnesis.dietType}</dd></div><div><dt>Attività</dt><dd>{ACTIVITY_MULTIPLIERS[patient.activityLevel].label}</dd></div></dl></section>
    <section className="panel overview-detail"><div className="panel-header"><div><h2>Continuità del percorso</h2><p>Follow-up e lavoro da completare</p></div><button className="text-button" onClick={() => onNewAppointment(patient.id)}><CalendarPlus size={14} />Pianifica</button></div><div className="followup-card"><CalendarPlus size={20} /><div><strong>{nextAppointment ? nextAppointment.visitType : 'Nessun appuntamento futuro'}</strong><span>{nextAppointment ? formatDateTime(nextAppointment.startsAt) : 'Pianifica il prossimo contatto'}</span></div></div><div className="quick-actions"><button onClick={() => onTab('measurements')}><LineChartIcon size={17} /><span>Nuova misurazione</span></button><button onClick={() => onTab('notes')}><NotebookPen size={17} /><span>Nota o attività</span></button><button onClick={() => onOpenDiary(patient.id)}><BookOpen size={17} /><span>Diario e aderenza</span></button></div></section>
  </div>
}

const anamnesisFields: { key: keyof Anamnesis; label: string; placeholder: string; type?: string }[] = [
  { key: 'conditions', label: 'Patologie e diagnosi', placeholder: 'Es. nessuna, ipotiroidismo…' },
  { key: 'medications', label: 'Farmaci', placeholder: 'Nome, dosaggio e frequenza' },
  { key: 'allergies', label: 'Allergie', placeholder: 'Allergie alimentari accertate' },
  { key: 'intolerances', label: 'Intolleranze', placeholder: 'Es. lattosio, nichel…' },
  { key: 'mealsOut', label: 'Pasti fuori casa / settimana', placeholder: '0', type: 'number' },
  { key: 'water', label: 'Acqua abituale', placeholder: 'Es. 1,5 L / giorno' },
  { key: 'alcohol', label: 'Alcol', placeholder: 'Frequenza e quantità' },
  { key: 'smoking', label: 'Fumo', placeholder: 'No, ex fumatore, sigarette / giorno' },
  { key: 'sleep', label: 'Sonno', placeholder: 'Ore e qualità percepita' },
  { key: 'stress', label: 'Stress percepito', placeholder: 'Basso, moderato, alto…' },
  { key: 'supplements', label: 'Integratori', placeholder: 'Nome, dosaggio e frequenza' },
]
function AnamnesisForm({ patient, workspace, notify }: { patient: Patient; workspace: Workspace; notify: (message: string) => void }) {
  const [form, setForm] = useState(patient.anamnesis)
  const [saving, setSaving] = useState(false)
  useEffect(() => setForm(patient.anamnesis), [patient.id, patient.anamnesis])
  const update = (key: keyof Anamnesis, value: string) => setForm(current => ({ ...current, [key]: value }))
  async function save() {
    setSaving(true)
    try { await workspace.updatePatient({ ...patient, anamnesis: form }); notify('Anamnesi salvata e disponibile nel percorso del paziente.') } catch { /* errore globale */ } finally { setSaving(false) }
  }
  return <div className="record-content"><section className="panel clinical-form"><div className="panel-header"><div><h2>Anamnesi nutrizionale</h2><p>Raccogli una sola volta le informazioni che guidano piano e follow-up.</p></div><span className="badge neutral"><Stethoscope size={13} />Area clinica</span></div><div className="form-grid anamnesis-grid">{anamnesisFields.map(field => <Field key={field.key} label={field.label}><input name={field.key} type={field.type ?? 'text'} min={field.type === 'number' ? 0 : undefined} value={form[field.key]} placeholder={field.placeholder} onChange={event => update(field.key, event.target.value)} /></Field>)}<Field label="Tipo di alimentazione"><select name="dietType" value={form.dietType} onChange={event => update('dietType', event.target.value)}><option>Onnivora</option><option>Vegetariana</option><option>Vegana</option><option>Pescetariana</option><option>Personalizzata</option></select></Field><Field label="Note cliniche" full><textarea name="clinicalNotes" rows={5} value={form.clinicalNotes} onChange={event => update('clinicalNotes', event.target.value)} placeholder="Sintomi, esami, riferimenti, preferenze e indicazioni per il piano…" /></Field></div><div className="form-footer"><span>I dati restano nello spazio privato del professionista.</span><button className="button primary" disabled={saving} onClick={() => void save()}><Check size={16} />{saving ? 'Salvataggio…' : 'Salva anamnesi'}</button></div></section></div>
}

function Measurements({ patient, measurements, onAdd }: { patient: Patient; measurements: Measurement[]; onAdd: () => void }) {
  const sorted = [...measurements].sort((a, b) => a.date.localeCompare(b.date))
  const chart = sorted.map(item => ({ ...item, label: formatDate(item.date, false) }))
  return <div className="record-content measurements-layout"><section className="panel measurement-chart"><div className="panel-header"><div><h2>Progressi antropometrici</h2><p>{measurements.length} rilevazioni · peso attuale di riferimento {patient.weight || '—'} kg</p></div><button className="button primary" onClick={onAdd}><Plus size={16} />Nuova misurazione</button></div>{chart.length ? <div className="chart-wrap large"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><YAxis domain={['dataMin - 2', 'dataMax + 2']} axisLine={false} tickLine={false} width={38} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} /><Line isAnimationActive={false} type="monotone" dataKey="weight" name="Peso (kg)" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--primary)' }} /></LineChart></ResponsiveContainer></div> : <EmptyState icon={<LineChartIcon size={28} />} title="Nessuna misurazione" text="Aggiungi peso e circonferenze per seguire i progressi nel tempo." />}</section><section className="panel measurement-history"><div className="panel-header"><div><h2>Storico</h2><p>Dal più recente</p></div></div>{measurements.length ? [...measurements].sort((a, b) => b.date.localeCompare(a.date)).map(item => <div className="measurement-row" key={item.id}><div><strong>{item.weight} kg</strong><span>{formatDate(item.date)}</span></div><div>{item.waist && <span>Vita {item.waist} cm</span>}{item.hip && <span>Fianchi {item.hip} cm</span>}{item.bodyFat && <span>Massa grassa {item.bodyFat}%</span>}{item.note && <p>{item.note}</p>}</div></div>) : <p className="muted-block">Le rilevazioni appariranno qui.</p>}</section></div>
}

function MeasurementModal({ patient, workspace, onClose, notify }: { patient: Patient; workspace: Workspace; onClose: () => void; notify: (message: string) => void }) {
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const number = (key: string) => data.get(key) ? Number(data.get(key)) : undefined
    try {
      const weight = Number(data.get('weight'))
      const date = String(data.get('date'))
      await workspace.addMeasurement({ patientId: patient.id, date, weight, waist: number('waist'), hip: number('hip'), arm: number('arm'), thigh: number('thigh'), bodyFat: number('bodyFat'), note: String(data.get('note')) })
      const latest = workspace.measurements.filter(item => item.patientId === patient.id).sort((a, b) => b.date.localeCompare(a.date))[0]
      if (!latest || date >= latest.date) await workspace.updatePatient({ ...patient, weight })
      notify(!latest || date >= latest.date ? 'Misurazione salvata e peso del profilo aggiornato.' : 'Misurazione storica salvata senza modificare il peso attuale.'); onClose()
    } catch { /* errore globale */ }
  }
  return <Modal title="Nuova misurazione" description={`Aggiorna i progressi di ${patient.name}.`} onClose={onClose}><form className="form-grid" onSubmit={submit}><Field label="Data"><input name="date" type="date" required defaultValue={todayKey()} /></Field><Field label="Peso (kg)"><input name="weight" type="number" min="30" step="0.1" required defaultValue={patient.weight || undefined} /></Field><Field label="Vita (cm)"><input name="waist" type="number" step="0.1" /></Field><Field label="Fianchi (cm)"><input name="hip" type="number" step="0.1" /></Field><Field label="Braccio (cm)"><input name="arm" type="number" step="0.1" /></Field><Field label="Coscia (cm)"><input name="thigh" type="number" step="0.1" /></Field><Field label="Massa grassa (%)"><input name="bodyFat" type="number" min="1" max="70" step="0.1" /></Field><Field label="Nota" full><input name="note" placeholder="Condizioni della rilevazione…" /></Field><button className="button primary full" type="submit">Salva misurazione</button></form></Modal>
}

function PatientDiets({ plans, workspace, onNewDiet, onOpenDiet, notify }: { plans: DietPlan[]; workspace: Workspace; onNewDiet: (id: string) => void; onOpenDiet: (plan: DietPlan) => void; notify: (message: string) => void }) {
  const patientId = plans[0]?.patientId
  async function duplicate(plan: DietPlan) {
    try { const copy = await workspace.saveDiet({ ...plan, id: crypto.randomUUID(), name: `${plan.name} · copia`, status: 'Bozza', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); notify('Piano duplicato come bozza.'); onOpenDiet(copy) } catch { /* errore globale */ }
  }
  return <div className="record-content"><div className="section-toolbar"><div><h2>Piani del paziente</h2><p>Duplica un piano per creare una nuova fase senza ripartire da zero.</p></div><button className="button primary" onClick={() => onNewDiet(patientId ?? workspace.patients[0]?.id)}><Plus size={16} />Nuova dieta</button></div>{plans.length ? <div className="diet-grid">{plans.map(plan => <article className="panel diet-card" key={plan.id}><div className="diet-card-head"><div className="diet-icon"><BookOpen size={21} /></div><span className={`badge ${plan.status === 'Pronta' ? 'success' : 'warning'}`}>{plan.status}</span></div><h3>{plan.name}</h3><p>{plan.calories} kcal · {plan.plan.kcalPct.length} pasti</p><div className="diet-stats"><div><FileText size={16} /><strong>{Object.values(plan.plan.days).filter(day => day.some(meal => meal.items.length)).length} / 7</strong><span>giorni composti</span></div><div><ClipboardList size={16} /><strong>{formatDate(plan.updatedAt.slice(0, 10))}</strong><span>ultima modifica</span></div></div><div className="patient-card-actions"><button className="button secondary" onClick={() => void duplicate(plan)}><Copy size={14} />Duplica</button><button className="button primary" onClick={() => onOpenDiet(plan)}>Apri piano<ArrowRight size={14} /></button></div></article>)}</div> : <section className="panel"><EmptyState icon={<BookOpen size={28} />} title="Nessun piano nutrizionale" text="Il fabbisogno è già disponibile: crea il primo piano senza reinserire i dati." action={<button className="button primary" onClick={() => onNewDiet(patientId ?? workspace.patients[0]?.id)}>Prepara dieta</button>} /></section>}</div>
}

function PatientNotes({ patient, workspace, notify }: { patient: Patient; workspace: Workspace; notify: (message: string) => void }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'Nota' | 'Attività'>('Nota')
  const [dueDate, setDueDate] = useState('')
  const notes = workspace.notes.filter(note => note.patientId === patient.id)
  async function add() {
    if (!text.trim()) return
    try { await workspace.addNote({ patientId: patient.id, text: text.trim(), kind, dueDate: kind === 'Attività' ? dueDate : undefined }); setText(''); setDueDate(''); notify(kind === 'Nota' ? 'Nota aggiunta alla cartella.' : 'Attività aggiunta al follow-up.') } catch { /* errore globale */ }
  }
  return <div className="record-content notes-layout"><section className="panel note-composer"><div className="panel-header"><div><h2>Nuova nota o attività</h2><p>Annota la visita o fissa il prossimo passo operativo.</p></div></div><div className="note-kind"><button className={kind === 'Nota' ? 'active' : ''} onClick={() => setKind('Nota')}><FileText size={15} />Nota clinica</button><button className={kind === 'Attività' ? 'active' : ''} onClick={() => setKind('Attività')}><CheckCircle2 size={15} />Attività</button></div><textarea rows={5} value={text} onChange={event => setText(event.target.value)} placeholder={kind === 'Nota' ? 'Esiti della visita, difficoltà emerse, indicazioni…' : 'Es. ricontattare per verificare il diario…'} />{kind === 'Attività' && <Field label="Scadenza"><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></Field>}<button className="button primary" disabled={!text.trim()} onClick={() => void add()}><Plus size={16} />Aggiungi</button></section><section className="panel note-timeline"><div className="panel-header"><div><h2>Timeline</h2><p>{notes.filter(note => note.kind === 'Attività' && !note.done).length} attività aperte</p></div></div>{notes.length ? notes.map(note => <article className={`timeline-note ${note.done ? 'done' : ''}`} key={note.id}><button className="note-check" disabled={note.kind === 'Nota'} onClick={() => void workspace.toggleNote(note).catch(() => {})} aria-label={note.done ? 'Riapri attività' : 'Completa attività'}>{note.kind === 'Attività' ? note.done ? <Check size={14} /> : <span /> : <FileText size={14} />}</button><div><span className="badge neutral">{note.kind}</span><p>{note.text}</p><small>{formatDateTime(note.createdAt)}{note.dueDate ? ` · scadenza ${formatDate(note.dueDate)}` : ''}</small></div></article>) : <EmptyState icon={<NotebookPen size={27} />} title="Nessuna nota" text="La timeline raccoglierà visite, decisioni e attività di follow-up." />}</section></div>
}

function EditPatientModal({ patient, workspace, onClose, notify }: { patient: Patient; workspace: Workspace; onClose: () => void; notify: (message: string) => void }) {
  const [draft, setDraft] = useState(patient)
  const update = <K extends keyof Patient>(key: K, value: Patient[K]) => setDraft(current => ({ ...current, [key]: value }))
  const tdee = calculateTDEE(draft)
  async function save() {
    try { await workspace.updatePatient(draft); notify('Profilo paziente aggiornato.'); onClose() } catch { /* errore globale */ }
  }
  return <Modal title="Modifica profilo" description="I dati metabolici alimenteranno i nuovi piani; quelli già salvati restano invariati." onClose={onClose} wide><div className="form-grid"><Field label="Nome e cognome" full><input value={draft.name} onChange={event => update('name', event.target.value)} /></Field><Field label="Email"><input type="email" value={draft.email} onChange={event => update('email', event.target.value)} /></Field><Field label="Telefono"><input value={draft.phone} onChange={event => update('phone', event.target.value)} /></Field><Field label="Età"><input type="number" value={draft.age} onChange={event => update('age', Number(event.target.value))} /></Field><Field label="Stato"><select value={draft.status} onChange={event => update('status', event.target.value as Patient['status'])}><option>Attivo</option><option>In follow-up</option><option>Archiviato</option></select></Field><Field label="Altezza (cm)"><input type="number" value={draft.height} onChange={event => update('height', Number(event.target.value))} /></Field><Field label="Peso (kg)"><input type="number" step="0.1" value={draft.weight} onChange={event => update('weight', Number(event.target.value))} /></Field><Field label="Attività" full><select value={draft.activityLevel} onChange={event => update('activityLevel', event.target.value as Patient['activityLevel'])}>{Object.entries(ACTIVITY_MULTIPLIERS).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}</select></Field><Field label="Obiettivo" full><input value={draft.goal} onChange={event => update('goal', event.target.value)} /></Field></div><div className="metabolic-preview"><div><span>Fabbisogno ricalcolato</span><strong>{tdee} kcal</strong></div><button className="button secondary" onClick={() => { const macros = macroGrams(tdee, { protein: 30, carbs: 40, fat: 30 }); setDraft(current => ({ ...current, calories: tdee, ...macros })) }}>Usa come target</button></div><div className="form-grid target-edit"><Field label="Target kcal"><input type="number" value={draft.calories} onChange={event => update('calories', Number(event.target.value))} /></Field><Field label="Proteine (g)"><input type="number" value={draft.protein} onChange={event => update('protein', Number(event.target.value))} /></Field><Field label="Carboidrati (g)"><input type="number" value={draft.carbs} onChange={event => update('carbs', Number(event.target.value))} /></Field><Field label="Grassi (g)"><input type="number" value={draft.fat} onChange={event => update('fat', Number(event.target.value))} /></Field></div><div className="form-footer"><button className="button secondary" onClick={onClose}>Annulla</button><button className="button primary" onClick={() => void save()}>Salva modifiche</button></div></Modal>
}
