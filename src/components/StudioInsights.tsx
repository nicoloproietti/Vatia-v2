import { useMemo, useState } from 'react'
import { Activity, ArrowRight, Banknote, BookOpen, CheckCircle2, TrendingUp, Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Workspace } from '../hooks/useWorkspace'
import { activePlanFor, adherenceForDays, dateKey, sumNutrients } from '../lib/clinical'
import type { Page } from '../types'
import { EmptyState, PatientAvatar } from './UI'

const money = (value: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)

export default function StudioInsights({ workspace, navigate, onSelectPatient }: { workspace: Workspace; navigate: (page: Page) => void; onSelectPatient: (id: string) => void }) {
  const [period, setPeriod] = useState('month')
  const now = new Date()
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const paid = workspace.invoices.filter(invoice => invoice.status === 'Pagata' && (period === 'all' || invoice.paymentDate?.startsWith(monthKey) || invoice.issueDate.startsWith(monthKey)))
  const collected = paid.reduce((sum, invoice) => sum + invoice.amount + (invoice.enpab ? invoice.amount * .04 : 0) + (invoice.stamp ? 2 : 0), 0)
  const due = workspace.invoices.filter(invoice => invoice.status === 'Emessa').reduce((sum, invoice) => sum + invoice.amount + (invoice.enpab ? invoice.amount * .04 : 0) + (invoice.stamp ? 2 : 0), 0)
  const patientRows = useMemo(() => workspace.patients.filter(patient => patient.status !== 'Archiviato').map(patient => {
    const plan = activePlanFor(workspace.plans, patient.id)
    const target = plan?.calories ?? patient.calories
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(); date.setDate(date.getDate() - (6 - index)); const key = dateKey(date)
      const entries = workspace.diary.filter(entry => entry.patientId === patient.id && entry.date === key)
      const nutrients = sumNutrients(entries.flatMap(entry => { const food = workspace.foods.find(item => item.id === entry.foodId); return food ? [{ food, grams: entry.grams }] : [] }))
      return { kcal: nutrients.kcal, target, entries: entries.length }
    })
    const measurements = workspace.measurements.filter(item => item.patientId === patient.id).sort((a, b) => a.date.localeCompare(b.date))
    const weightDelta = measurements.length > 1 ? measurements[measurements.length - 1].weight - measurements[0].weight : 0
    return { patient, plan, adherence: adherenceForDays(days), logged: days.filter(day => day.entries).length, weightDelta }
  }), [workspace])
  const chartData = patientRows.filter(row => row.logged).slice(0, 8).map(row => ({ name: row.patient.name.split(' ')[0], Aderenza: row.adherence, Giorni: row.logged }))
  const active = patientRows.length
  const readyPlans = workspace.plans.filter(plan => plan.status === 'Pronta').length
  const average = patientRows.filter(row => row.logged).length ? Math.round(patientRows.filter(row => row.logged).reduce((sum, row) => sum + row.adherence, 0) / patientRows.filter(row => row.logged).length) : 0
  return <>
    <section className="page-heading"><div><span className="eyebrow">POLMONI DELLO STUDIO</span><h1>Insight di studio</h1><p>Una vista trasversale su percorsi, aderenza e risultati economici.</p></div><select className="period-select" aria-label="Periodo incassi" value={period} onChange={event => setPeriod(event.target.value)}><option value="month">Questo mese</option><option value="all">Tutto lo storico</option></select></section>
    <section className="stats-grid"><article className="stat-card"><div className="stat-icon"><Users size={20} /></div><span>Pazienti attivi</span><strong>{active}</strong><small>{workspace.patients.length - active} archiviati</small></article><article className="stat-card"><div className="stat-icon"><Activity size={20} /></div><span>Aderenza media</span><strong>{patientRows.some(row => row.logged) ? `${average}%` : '—'}</strong><small>Ultimi 7 giorni con dati</small></article><article className="stat-card"><div className="stat-icon"><CheckCircle2 size={20} /></div><span>Piani pronti</span><strong>{readyPlans}</strong><small>{workspace.plans.filter(plan => plan.status === 'Bozza').length} da completare</small></article><article className="stat-card"><div className="stat-icon"><Banknote size={20} /></div><span>Incassato</span><strong>{money(collected)}</strong><small>{money(due)} ancora da incassare</small></article></section>
    <div className="studio-insights-grid"><section className="panel"><div className="panel-header"><div><h2>Aderenza per paziente</h2><p>Confronto immediato degli ultimi 7 giorni</p></div><TrendingUp size={19} /></div>{chartData.length ? <div className="chart-wrap large"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}><CartesianGrid horizontal={false} stroke="var(--border)" /><XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted)' }} /><YAxis type="category" dataKey="name" width={65} tick={{ fontSize: 10, fill: 'var(--muted)' }} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} /><Bar isAnimationActive={false} dataKey="Aderenza" unit="%" fill="#0f8f80" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyState icon={<Activity size={28} />} title="Nessun dato trasversale" text="Le giornate registrate in Monitoraggio alimenteranno questo grafico." action={<button className="text-button" onClick={() => navigate('diario')}>Apri monitoraggio<ArrowRight size={14} /></button>} />}</section>
      <section className="panel"><div className="panel-header"><div><h2>Priorità operative</h2><p>Dati insufficienti o aderenza da esaminare</p></div><button className="text-button" onClick={() => navigate('diario')}>Monitoraggio</button></div><div className="insight-patient-list">{[...patientRows].sort((a, b) => (a.logged >= 3 ? 1 : 0) - (b.logged >= 3 ? 1 : 0) || a.adherence - b.adherence).slice(0, 6).map(row => <button key={row.patient.id} onClick={() => { onSelectPatient(row.patient.id); navigate('pazienti') }}><PatientAvatar patient={row.patient} /><div><strong>{row.patient.name}</strong><span>{row.logged}/7 giorni · {row.logged ? `${row.adherence}% aderenza` : 'nessun dato recente'}{row.weightDelta ? ` · peso ${row.weightDelta > 0 ? '+' : ''}${row.weightDelta.toFixed(1)} kg` : ''}</span></div><ArrowRight size={16} /></button>)}</div>{!patientRows.length && <EmptyState icon={<Users size={28} />} title="Nessun percorso attivo" text="Crea un paziente per iniziare l’analisi." />}</section>
      <section className="panel insight-economics"><div><span className="eyebrow">CICLO COMPLETO</span><h2>Dalla visita al risultato, senza perdere il filo.</h2><p>Pazienti e diete restano clinici; appuntamenti e compensi restano amministrativi. Questa vista li riunisce solo per decidere le priorità dello studio.</p></div><button className="button secondary" onClick={() => navigate('fatture')}><BookOpen size={16} />Apri report economico</button></section>
    </div>
  </>
}
