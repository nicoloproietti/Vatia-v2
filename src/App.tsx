import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertCircle, ArrowRight, BarChart3, BookOpen, CalendarDays, Check, ChevronDown, Copy, Database, LayoutDashboard, Leaf, LogOut, Menu, Moon, Plus, Sun, Trash2, Users, Utensils, X, type LucideIcon } from 'lucide-react'
import { supabase } from './lib/supabase'
import { useWorkspace } from './hooks/useWorkspace'
import type { DietPlan, Page, Patient } from './types'
import { createEmptyDiet, formatDate, uid } from './lib/clinical'
import AuthScreen from './components/AuthScreen'
import NewPatientWizard from './components/NewPatientWizard'
import PatientManager from './components/PatientManager'
import DietBuilder from './components/DietBuilder'
import DiaryView from './components/DiaryView'
import DatabaseView from './components/DatabaseView'
import { CalendarView, Dashboard, InsightsView } from './components/PracticeViews'
import { EmptyState, PatientSelect } from './components/UI'
import './App.css'
import './clinical.css'

const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'oggi', label: 'Oggi', icon: LayoutDashboard },
  { id: 'pazienti', label: 'Pazienti', icon: Users },
  { id: 'diario', label: 'Diario alimentare', icon: BookOpen },
  { id: 'diete', label: 'Diete', icon: Utensils },
  { id: 'database', label: 'Database alimenti', icon: Database },
  { id: 'insights', label: 'Insight', icon: BarChart3 },
  { id: 'calendario', label: 'Calendario', icon: CalendarDays },
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [guest, setGuest] = useState(() => localStorage.getItem('vatia-v2-guest') === 'true')
  const [page, setPage] = useState<Page>('oggi')
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [activePlan, setActivePlan] = useState<DietPlan | null>(null)
  const [newPatientOpen, setNewPatientOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('vatia-v2-dark') === 'true')
  const [toast, setToast] = useState('')
  const workspace = useWorkspace(session)
  const effectivePatientId = workspace.patients.some(patient => patient.id === selectedPatientId) ? selectedPatientId : workspace.patients[0]?.id ?? ''
  const selectedPatient = workspace.patients.find(patient => patient.id === effectivePatientId)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthLoading(false) })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(''), 4200); return () => window.clearTimeout(timeout) }, [toast])

  function navigate(next: Page) { setActivePlan(null); setPage(next); setMobileNav(false) }
  function notify(message: string) { setToast(message) }
  function toggleTheme() { const next = !dark; setDark(next); localStorage.setItem('vatia-v2-dark', String(next)) }
  function enterGuest() { localStorage.setItem('vatia-v2-guest', 'true'); setGuest(true) }
  function exitGuest() { localStorage.removeItem('vatia-v2-guest'); setGuest(false); setPage('oggi'); setActivePlan(null); setSelectedPatientId('') }
  function newDiet(patientId = effectivePatientId) {
    const patient = workspace.patients.find(item => item.id === patientId)
    if (!patient) { setNewPatientOpen(true); return }
    setSelectedPatientId(patient.id)
    const now = new Date().toISOString()
    setActivePlan({ id: uid(), patientId: patient.id, name: `Piano nutrizionale · ${patient.name}`, status: 'Bozza', calories: patient.calories || 1800, plan: createEmptyDiet(patient.calories || 1800), createdAt: now, updatedAt: now })
    setPage('diete')
  }
  function openDiet(plan: DietPlan) { setSelectedPatientId(plan.patientId); setActivePlan(structuredClone(plan)); setPage('diete') }
  function openDiary(patientId: string) { setSelectedPatientId(patientId); navigate('diario') }

  async function createPatient(input: Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>, openDiet: boolean) {
    try {
      const patient = await workspace.createPatient(input)
      if (input.weight > 0) await workspace.addMeasurement({ patientId: patient.id, date: new Date().toISOString().slice(0, 10), weight: input.weight, note: 'Rilevazione iniziale' })
      setSelectedPatientId(patient.id); setNewPatientOpen(false)
      notify('Paziente creato: profilo e prima rilevazione sono pronti.')
      if (openDiet) newDiet(patient.id); else navigate('pazienti')
    } catch { /* errore mostrato nell’area di lavoro */ }
  }

  if (authLoading || (session && workspace.loading)) return <main className="auth-shell app-shell"><div className="auth-loading"><div className="brand-mark"><Leaf size={23} /></div><strong>Vatia</strong><span>Sto preparando il tuo spazio di lavoro…</span></div></main>
  if (supabase && !session && !guest) return <AuthScreen onGuest={enterGuest} />

  const userName = session?.user.user_metadata?.full_name?.split(' ')[0] || session?.user.email?.split('@')[0] || (guest ? 'Ospite' : 'Nutrizionista')
  const pageTitle = activePlan ? 'Builder dieta' : NAV.find(item => item.id === page)?.label ?? 'Oggi'

  return <div className={`app-shell ${dark ? 'dark' : ''}`}>
    {mobileNav && <button className="nav-backdrop" aria-label="Chiudi navigazione" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Leaf size={23} strokeWidth={2.4} /></div><span>vatia</span><small>PRO</small></div>
      <div className="workspace"><div className="workspace-icon">NP</div><div><strong>Studio Nutrizionale</strong><span>Area professionale</span></div><ChevronDown size={15} /></div>
      <nav className="main-nav" aria-label="Navigazione principale"><span className="nav-caption">AREA DI LAVORO</span>{NAV.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={19} /><span>{item.label}</span>{item.id === 'pazienti' && <b>{workspace.patients.length}</b>}{item.id === 'diete' && <b>{workspace.plans.length}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className={`sync-card ${session ? 'connected' : ''}`}><div><span className="status-dot" />{session ? 'Spazio cloud protetto' : 'Area locale attiva'}</div><p>{session ? 'Dati separati per account nel progetto Vatia dedicato.' : 'I dati restano in questo browser. Accedi con un account per sincronizzarli.'}</p></div><button className="profile-button" title={session ? 'Esci da Vatia' : guest ? 'Esci dall’area ospite' : 'Profilo locale'} onClick={() => { if (session) void supabase?.auth.signOut(); else if (guest) exitGuest() }}><div className="avatar">{userName.slice(0, 2).toUpperCase()}</div><div><strong>{session?.user.email ?? (guest ? 'Ospite' : 'Area locale')}</strong><span>{session ? 'Esci dall’account' : guest ? 'Torna all’accesso' : 'Nutrizionista'}</span></div>{session || guest ? <LogOut size={18} /> : null}</button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Apri navigazione"><Menu size={21} /></button><div className="breadcrumb"><span>Vatia</span><i>/</i><strong>{pageTitle}</strong></div><div className="topbar-actions">{workspace.patients.length > 0 && <PatientSelect patients={workspace.patients} value={effectivePatientId} onChange={setSelectedPatientId} label="Paziente attivo" />}<button className="icon-button" onClick={toggleTheme} aria-label="Cambia tema">{dark ? <Sun size={19} /> : <Moon size={19} />}</button><button className="button primary compact" onClick={() => setNewPatientOpen(true)}><Plus size={17} />Nuovo paziente</button></div></header>
      {workspace.error && <div className="workspace-error" role="alert"><AlertCircle size={17} /><span>{workspace.error}</span><button className="icon-button" onClick={() => workspace.setError('')} aria-label="Chiudi errore"><X size={16} /></button></div>}
      <div className={`content ${activePlan ? 'builder-content' : ''}`}>
        {page === 'oggi' && <Dashboard workspace={workspace} userName={userName} selectedPatientId={effectivePatientId} onSelectPatient={setSelectedPatientId} navigate={navigate} onNewPatient={() => setNewPatientOpen(true)} onNewAppointment={() => navigate('calendario')} />}
        {page === 'pazienti' && <PatientManager workspace={workspace} selectedPatientId={effectivePatientId} onSelectPatient={setSelectedPatientId} onNewPatient={() => setNewPatientOpen(true)} onNewDiet={newDiet} onOpenDiet={openDiet} onOpenDiary={openDiary} onNewAppointment={() => navigate('calendario')} notify={notify} />}
        {page === 'diario' && <DiaryView workspace={workspace} patient={selectedPatient} patients={workspace.patients} onSelectPatient={setSelectedPatientId} onNewDiet={newDiet} notify={notify} />}
        {page === 'diete' && (activePlan && selectedPatient ? <DietBuilder key={activePlan.id} workspace={workspace} plan={activePlan} patient={selectedPatient} onBack={() => setActivePlan(null)} notify={notify} /> : <DietsList workspace={workspace} onNewDiet={newDiet} onOpenDiet={openDiet} notify={notify} />)}
        {page === 'database' && <DatabaseView workspace={workspace} notify={notify} />}
        {page === 'insights' && <InsightsView workspace={workspace} patient={selectedPatient} patients={workspace.patients} onSelectPatient={setSelectedPatientId} />}
        {page === 'calendario' && <CalendarView workspace={workspace} initialPatientId={effectivePatientId} onSelectPatient={id => { setSelectedPatientId(id); navigate('pazienti') }} notify={notify} />}
      </div>
    </main>
    {newPatientOpen && <NewPatientWizard onClose={() => setNewPatientOpen(false)} onCreate={createPatient} />}
    {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button onClick={() => setToast('')} aria-label="Chiudi notifica"><X size={15} /></button></div>}
  </div>
}

function DietsList({ workspace, onNewDiet, onOpenDiet, notify }: { workspace: ReturnType<typeof useWorkspace>; onNewDiet: (id?: string) => void; onOpenDiet: (plan: DietPlan) => void; notify: (message: string) => void }) {
  const [patientFilter, setPatientFilter] = useState('all')
  const plans = workspace.plans.filter(plan => patientFilter === 'all' || plan.patientId === patientFilter)
  async function duplicate(plan: DietPlan) {
    try { await workspace.saveDiet({ ...plan, id: uid(), name: `${plan.name} · copia`, status: 'Bozza', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); notify('Piano duplicato come bozza.') } catch { /* errore globale */ }
  }
  async function remove(plan: DietPlan) {
    if (!window.confirm(`Eliminare definitivamente “${plan.name}”?`)) return
    try { await workspace.deleteDiet(plan.id); notify('Piano eliminato.') } catch { /* errore globale */ }
  }
  return <>
    <section className="page-heading"><div><span className="eyebrow">PIANI NUTRIZIONALI</span><h1>Diete</h1><p>Costruisci, duplica e revisiona i piani settimanali dei pazienti.</p></div><button className="button primary" onClick={() => onNewDiet()}><Plus size={17} />Nuova dieta</button></section>
    {workspace.plans.length > 0 && <div className="list-filter"><select aria-label="Filtra per paziente" value={patientFilter} onChange={event => setPatientFilter(event.target.value)}><option value="all">Tutti i pazienti</option>{workspace.patients.map(patient => <option value={patient.id} key={patient.id}>{patient.name}</option>)}</select><span>{plans.length} piani</span></div>}
    {plans.length ? <div className="diet-grid">{plans.map(plan => { const patient = workspace.patients.find(item => item.id === plan.patientId); const composedDays = Object.values(plan.plan.days).filter(day => day.length && day.every(meal => meal.items.length)).length; return <article className="panel diet-card" key={plan.id}><div className="diet-card-head"><div className="diet-icon"><BookOpen size={21} /></div><span className={`badge ${plan.status === 'Pronta' ? 'success' : 'warning'}`}>{plan.status}</span></div><h3>{plan.name}</h3><p>{patient?.name ?? 'Paziente non disponibile'}</p><div className="diet-stats"><div><Utensils size={16} /><strong>{plan.calories} kcal · {plan.plan.kcalPct.length} pasti</strong><span>target giornaliero</span></div><div><CalendarDays size={16} /><strong>{composedDays} / 7 giorni</strong><span>modificato {formatDate(plan.updatedAt.slice(0, 10))}</span></div></div><div className="diet-card-actions"><button className="icon-button" title="Duplica piano" onClick={() => void duplicate(plan)}><Copy size={16} /></button><button className="icon-button danger" title="Elimina piano" onClick={() => void remove(plan)}><Trash2 size={16} /></button><button className="button primary" onClick={() => onOpenDiet(plan)}>Apri piano<ArrowRight size={15} /></button></div></article>})}</div> : <section className="panel"><EmptyState icon={<BookOpen size={30} />} title={workspace.plans.length ? 'Nessun piano per questo paziente' : 'Nessun piano creato'} text="Il builder riprende fabbisogno, alimenti e struttura dei pasti dal paziente selezionato." action={<button className="button primary" onClick={() => onNewDiet(patientFilter === 'all' ? undefined : patientFilter)}><Plus size={16} />Crea piano</button>} /></section>}
  </>
}
