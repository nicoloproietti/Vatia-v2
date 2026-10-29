import { useMemo, useRef, useState } from 'react'
import {
  Apple, ArrowLeft, ArrowRight, BarChart3, BookOpen, CalendarDays,
  ChevronDown, CircleUserRound, Clock3, Database, Download, Flame,
  LayoutDashboard, Leaf, Menu, Moon, MoreHorizontal, Plus, Search,
  Sparkles, Star, Sun, Target, Trash2, TrendingUp, Upload, Users,
  Utensils, X, type LucideIcon,
} from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { FOOD_CATEGORIES, foods as baseFoods } from './data/foods'
import './App.css'

type Page = 'oggi' | 'pazienti' | 'diario' | 'diete' | 'database' | 'insights' | 'calendario'
type Meal = 'Colazione' | 'Pranzo' | 'Cena' | 'Spuntini'
type Food = (typeof baseFoods)[number] & { brand?: string; barcode?: string; source?: string; favorite?: boolean }
type Patient = { id: string; name: string; age: number; goal: string; status: string; adherence: number; lastVisit: string; calories: number; protein: number; carbs: number; fat: number }
type DiaryEntry = { id: string; food: Food; grams: number; meal: Meal }
type DietPlan = { id: string; patientId: string; name: string; status: 'Bozza' | 'Pronta'; calories: number; updated: string }
type Modal = 'patient' | 'food' | 'diary' | 'diet' | null

const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'oggi', label: 'Oggi', icon: LayoutDashboard },
  { id: 'pazienti', label: 'Pazienti', icon: Users },
  { id: 'diario', label: 'Diario alimentare', icon: BookOpen },
  { id: 'diete', label: 'Diete', icon: Utensils },
  { id: 'database', label: 'Database alimenti', icon: Database },
  { id: 'insights', label: 'Insight', icon: BarChart3 },
  { id: 'calendario', label: 'Calendario', icon: CalendarDays },
]
const MEALS: Meal[] = ['Colazione', 'Pranzo', 'Cena', 'Spuntini']
const demoPatients: Patient[] = [
  { id: 'p1', name: 'Giulia Bianchi', age: 34, goal: 'Ricomposizione corporea', status: 'In follow-up', adherence: 86, lastVisit: '24 ott 2026', calories: 1850, protein: 115, carbs: 190, fat: 65 },
  { id: 'p2', name: 'Marco Rossi', age: 42, goal: 'Perdita di peso', status: 'Attivo', adherence: 72, lastVisit: '21 ott 2026', calories: 2100, protein: 140, carbs: 220, fat: 70 },
  { id: 'p3', name: 'Elena Verdi', age: 29, goal: 'Performance sportiva', status: 'Attivo', adherence: 93, lastVisit: '18 ott 2026', calories: 2300, protein: 130, carbs: 280, fat: 70 },
]
const demoDiary: DiaryEntry[] = [
  { id: 'd1', food: baseFoods[6], grams: 80, meal: 'Colazione' },
  { id: 'd2', food: baseFoods[0], grams: 110, meal: 'Pranzo' },
  { id: 'd3', food: baseFoods[24], grams: 150, meal: 'Cena' },
]
const weeklyData = [
  { day: 'Lun', kcal: 1740, target: 1850 }, { day: 'Mar', kcal: 1910, target: 1850 },
  { day: 'Mer', kcal: 1810, target: 1850 }, { day: 'Gio', kcal: 1885, target: 1850 },
  { day: 'Ven', kcal: 1760, target: 1850 }, { day: 'Sab', kcal: 1980, target: 1850 },
  { day: 'Dom', kcal: 1840, target: 1850 },
]
const macroData = [
  { name: 'Proteine', value: 92, fill: '#0d9488' }, { name: 'Carboidrati', value: 78, fill: '#14b8a6' },
  { name: 'Grassi', value: 84, fill: '#64748b' }, { name: 'Fibre', value: 68, fill: '#94a3b8' },
]
const appointments = [
  { time: '09:30', name: 'Giulia Bianchi', type: 'Visita di controllo', duration: '45 min' },
  { time: '11:00', name: 'Marco Rossi', type: 'Revisione piano', duration: '30 min' },
  { time: '15:30', name: 'Elena Verdi', type: 'Prima visita', duration: '60 min' },
]

function readStored<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}
function initials(name: string) { return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() }
function round(value: number) { return Math.round(value * 10) / 10 }
function formatToday(date: Date) { return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(date) }

export default function App() {
  const [page, setPage] = useState<Page>('oggi')
  const [patients, setPatients] = useState<Patient[]>(() => readStored('vatia-v2-patients', demoPatients))
  const [selectedPatientId, setSelectedPatientId] = useState('p1')
  const [diary, setDiary] = useState<DiaryEntry[]>(() => readStored('vatia-v2-diary', demoDiary))
  const [customFoods, setCustomFoods] = useState<Food[]>(() => readStored('vatia-v2-foods', []))
  const [favorites, setFavorites] = useState<string[]>(() => readStored('vatia-v2-favorites', []))
  const [plans, setPlans] = useState<DietPlan[]>(() => readStored('vatia-v2-plans', [
    { id: 'diet1', patientId: 'p1', name: 'Piano ricomposizione · Ottobre', status: 'Pronta', calories: 1850, updated: 'Oggi' },
    { id: 'diet2', patientId: 'p2', name: 'Piano ipocalorico · Fase 2', status: 'Bozza', calories: 2100, updated: 'Ieri' },
  ]))
  const [modal, setModal] = useState<Modal>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [dark, setDark] = useState(() => readStored('vatia-v2-dark', false))
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [date, setDate] = useState(new Date())
  const fileInput = useRef<HTMLInputElement>(null)
  const selectedPatient = patients.find(patient => patient.id === selectedPatientId) ?? patients[0]
  const allFoods = useMemo(() => [...customFoods, ...baseFoods] as Food[], [customFoods])
  const filteredFoods = useMemo(() => allFoods.filter(food => {
    const matchesQuery = `${food.name} ${food.note ?? ''} ${food.brand ?? ''}`.toLowerCase().includes(query.toLowerCase())
    const matchesCategory = category === 'all' || food.category === category
    return matchesQuery && matchesCategory && (!onlyFavorites || favorites.includes(food.id))
  }), [allFoods, query, category, onlyFavorites, favorites])
  const totals = useMemo(() => diary.reduce((sum, entry) => {
    const factor = entry.grams / 100
    sum.kcal += (entry.food.per100g.kcal ?? 0) * factor
    sum.protein += (entry.food.per100g.protein ?? 0) * factor
    sum.carbs += (entry.food.per100g.carbs ?? 0) * factor
    sum.fat += (entry.food.per100g.fat ?? 0) * factor
    return sum
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 }), [diary])

  function persist<T>(key: string, setter: (value: T) => void, value: T) { setter(value); localStorage.setItem(key, JSON.stringify(value)) }
  function navigate(next: Page) { setPage(next); setMobileNav(false); setQuery('') }
  function toggleTheme() { const next = !dark; setDark(next); localStorage.setItem('vatia-v2-dark', JSON.stringify(next)) }
  function toggleFavorite(id: string) { const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]; persist('vatia-v2-favorites', setFavorites, next) }
  function addDiaryFood(food: Food, grams = 100, meal: Meal = 'Pranzo') {
    const next = [...diary, { id: crypto.randomUUID(), food, grams, meal }]
    persist('vatia-v2-diary', setDiary, next); setModal(null); navigate('diario')
  }
  function removeDiaryFood(id: string) { persist('vatia-v2-diary', setDiary, diary.filter(entry => entry.id !== id)) }
  function shiftDate(days: number) { const next = new Date(date); next.setDate(next.getDate() + days); setDate(next) }

  function submitPatient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const patient: Patient = { id: crypto.randomUUID(), name: String(data.get('name')), age: Number(data.get('age')), goal: String(data.get('goal')), status: 'Attivo', adherence: 0, lastVisit: 'Mai', calories: Number(data.get('calories')), protein: 100, carbs: 180, fat: 60 }
    persist('vatia-v2-patients', setPatients, [...patients, patient]); setSelectedPatientId(patient.id); setModal(null); navigate('pazienti')
  }
  function submitFood(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const food: Food = { id: `custom-${crypto.randomUUID()}`, name: String(data.get('name')), brand: String(data.get('brand')), barcode: String(data.get('barcode')), category: String(data.get('category')), note: String(data.get('note')), meals: 'all', source: 'Alimento personale', per100g: { kcal: Number(data.get('kcal')), protein: Number(data.get('protein')), carbs: Number(data.get('carbs')), fat: Number(data.get('fat')) } }
    persist('vatia-v2-foods', setCustomFoods, [food, ...customFoods]); setModal(null); navigate('database')
  }
  function submitDiet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const plan: DietPlan = { id: crypto.randomUUID(), patientId: selectedPatient.id, name: String(data.get('name')), status: 'Bozza', calories: Number(data.get('calories')), updated: 'Adesso' }
    persist('vatia-v2-plans', setPlans, [plan, ...plans]); setModal(null); navigate('diete')
  }
  async function importFoods(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Food[]
      if (!Array.isArray(parsed) || !parsed.every(food => food.id && food.name && food.per100g)) throw new Error('invalid')
      persist('vatia-v2-foods', setCustomFoods, [...parsed, ...customFoods])
    } catch { window.alert('Formato non valido. Usa un array JSON di alimenti con id, name e per100g.') }
    event.target.value = ''
  }
  function exportDiary() {
    const rows = [['Pasto', 'Alimento', 'Grammi', 'Kcal', 'Proteine', 'Carboidrati', 'Grassi'], ...diary.map(entry => [entry.meal, entry.food.name, entry.grams, round(entry.food.per100g.kcal * entry.grams / 100), round(entry.food.per100g.protein * entry.grams / 100), round(entry.food.per100g.carbs * entry.grams / 100), round(entry.food.per100g.fat * entry.grams / 100)])]
    const blob = new Blob([rows.map(row => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'vatia-diario.csv'; link.click(); URL.revokeObjectURL(url)
  }

  const pageTitle = NAV.find(item => item.id === page)?.label ?? 'Oggi'
  const caloriePercent = selectedPatient ? Math.min(100, Math.round(totals.kcal / selectedPatient.calories * 100)) : 0

  return (
    <div className={`app-shell ${dark ? 'dark' : ''}`}>
      {mobileNav && <button className="nav-backdrop" aria-label="Chiudi navigazione" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Leaf size={23} strokeWidth={2.4} /></div><span>vatia</span><small>PRO</small></div>
        <div className="workspace"><div className="workspace-icon">NP</div><div><strong>Studio Nutrizionale</strong><span>Area professionale</span></div><ChevronDown size={15} /></div>
        <nav className="main-nav" aria-label="Navigazione principale">
          <span className="nav-caption">AREA DI LAVORO</span>
          {NAV.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={19} /><span>{item.label}</span>{item.id === 'diario' && <b>{diary.length}</b>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-card"><div><span className="status-dot" />Demo locale attiva</div><p>Il nuovo progetto Supabase verrà collegato in fase di configurazione.</p></div>
          <button className="profile-button"><div className="avatar">NP</div><div><strong>Nicolo Proietti</strong><span>Nutrizionista</span></div><MoreHorizontal size={18} /></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Apri navigazione"><Menu size={21} /></button>
          <div className="breadcrumb"><span>Vatia</span><i>/</i><strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => navigate('database')}><Search size={17} /><span>Cerca alimenti, pazienti…</span><kbd>⌘ K</kbd></button>
            <button className="icon-button" onClick={toggleTheme} aria-label="Cambia tema">{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
            <button className="button primary compact" onClick={() => setModal('patient')}><Plus size={17} />Nuovo paziente</button>
          </div>
        </header>

        <div className="content">
          {page === 'oggi' && <>
            <section className="page-heading"><div><span className="eyebrow">{formatToday(new Date())}</span><h1>Buongiorno, Nicolo.</h1><p>Ecco cosa sta succedendo nel tuo studio.</p></div><button className="button secondary" onClick={() => navigate('calendario')}><CalendarDays size={17} />Vedi agenda</button></section>
            <section className="stats-grid">
              <StatCard icon={Users} label="Pazienti attivi" value={String(patients.length)} note="+2 questo mese" />
              <StatCard icon={CalendarDays} label="Visite di oggi" value="3" note="Prossima alle 09:30" />
              <StatCard icon={Target} label="Aderenza media" value={`${Math.round(patients.reduce((sum, p) => sum + p.adherence, 0) / patients.length)}%`} note="+4% rispetto a ottobre" positive />
              <StatCard icon={BookOpen} label="Diete da revisionare" value={String(plans.filter(plan => plan.status === 'Bozza').length)} note="1 aggiornata ieri" />
            </section>
            <div className="dashboard-grid">
              <section className="panel nutrition-panel">
                <PanelHeader title="Quadro nutrizionale" subtitle={selectedPatient.name} action={<PatientSelect patients={patients} value={selectedPatientId} onChange={setSelectedPatientId} />} />
                <div className="nutrition-body">
                  <div className="calorie-ring" style={{ '--progress': `${caloriePercent * 3.6}deg` } as React.CSSProperties}><div><Flame size={20} /><strong>{Math.round(totals.kcal)}</strong><span>di {selectedPatient.calories} kcal</span></div></div>
                  <div className="macro-list"><MacroRow label="Proteine" value={totals.protein} target={selectedPatient.protein} unit="g" color="teal" /><MacroRow label="Carboidrati" value={totals.carbs} target={selectedPatient.carbs} unit="g" color="mint" /><MacroRow label="Grassi" value={totals.fat} target={selectedPatient.fat} unit="g" color="slate" /></div>
                </div>
                <button className="panel-link" onClick={() => navigate('diario')}>Apri il diario completo <ArrowRight size={16} /></button>
              </section>
              <section className="panel schedule-panel"><PanelHeader title="In agenda oggi" subtitle="3 appuntamenti" action={<button className="text-button" onClick={() => navigate('calendario')}>Vedi tutti</button>} /><div className="appointment-list">{appointments.map(item => <div className="appointment" key={item.time}><div className="appointment-time">{item.time}</div><div className="appointment-line" /><div><strong>{item.name}</strong><span>{item.type} · {item.duration}</span></div></div>)}</div></section>
              <section className="panel chart-panel"><PanelHeader title="Andamento settimanale" subtitle="Calorie registrate rispetto all’obiettivo" action={<span className="badge success"><TrendingUp size={13} />+4,2%</span>} /><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={weeklyData}><defs><linearGradient id="calories" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f9f8f" stopOpacity={0.28} /><stop offset="100%" stopColor="#0f9f8f" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }} /><Area type="monotone" dataKey="kcal" stroke="#0f9f8f" strokeWidth={2.5} fill="url(#calories)" /></AreaChart></ResponsiveContainer></div></section>
              <section className="panel patients-panel"><PanelHeader title="Pazienti recenti" subtitle="Aggiornamenti e aderenza" action={<button className="text-button" onClick={() => navigate('pazienti')}>Tutti i pazienti</button>} /><div className="patient-list">{patients.slice(0, 3).map(patient => <button className="patient-row" key={patient.id} onClick={() => { setSelectedPatientId(patient.id); navigate('pazienti') }}><div className="avatar soft">{initials(patient.name)}</div><div className="patient-main"><strong>{patient.name}</strong><span>{patient.goal}</span></div><div className="adherence"><span>{patient.adherence}% aderenza</span><div><i style={{ width: `${patient.adherence}%` }} /></div></div><ArrowRight size={16} /></button>)}</div></section>
            </div>
          </>}

          {page === 'pazienti' && <>
            <section className="page-heading"><div><span className="eyebrow">GESTIONE STUDIO</span><h1>Pazienti</h1><p>Profili, obiettivi e percorsi nutrizionali in un unico posto.</p></div><button className="button primary" onClick={() => setModal('patient')}><Plus size={17} />Nuovo paziente</button></section>
            <div className="patient-card-grid">{patients.map(patient => <article className={`patient-card ${selectedPatientId === patient.id ? 'selected' : ''}`} key={patient.id} onClick={() => setSelectedPatientId(patient.id)}><div className="patient-card-top"><div className="avatar large">{initials(patient.name)}</div><span className="badge neutral">{patient.status}</span></div><h3>{patient.name}</h3><p>{patient.age} anni · {patient.goal}</p><div className="patient-metrics"><div><span>Aderenza</span><strong>{patient.adherence}%</strong></div><div><span>Ultima visita</span><strong>{patient.lastVisit}</strong></div></div><div className="progress-track"><i style={{ width: `${patient.adherence}%` }} /></div><div className="patient-card-actions"><button className="button secondary" onClick={() => navigate('diario')}>Diario</button><button className="button primary" onClick={() => setModal('diet')}>Nuova dieta</button></div></article>)}</div>
          </>}

          {page === 'diario' && <>
            <section className="page-heading"><div><span className="eyebrow">MONITORAGGIO PAZIENTE</span><h1>Diario alimentare</h1><p>{selectedPatient.name} · {formatToday(date)}</p></div><div className="heading-actions"><button className="button secondary" onClick={exportDiary}><Download size={17} />Esporta CSV</button><button className="button primary" onClick={() => setModal('diary')}><Plus size={17} />Aggiungi alimento</button></div></section>
            <div className="date-switcher"><button className="icon-button" onClick={() => shiftDate(-1)}><ArrowLeft size={18} /></button><strong>{formatToday(date)}</strong><button className="icon-button" onClick={() => shiftDate(1)}><ArrowRight size={18} /></button></div>
            <section className="diary-summary"><div><span>Calorie</span><strong>{Math.round(totals.kcal)} <small>/ {selectedPatient.calories} kcal</small></strong></div><div><span>Proteine</span><strong>{round(totals.protein)} g</strong></div><div><span>Carboidrati</span><strong>{round(totals.carbs)} g</strong></div><div><span>Grassi</span><strong>{round(totals.fat)} g</strong></div></section>
            <div className="meals-list">{MEALS.map(meal => { const entries = diary.filter(entry => entry.meal === meal); const mealKcal = entries.reduce((sum, entry) => sum + entry.food.per100g.kcal * entry.grams / 100, 0); return <section className="panel meal-panel" key={meal}><div className="meal-header"><div><Utensils size={18} /><h3>{meal}</h3><span>{Math.round(mealKcal)} kcal</span></div><button className="icon-button" onClick={() => setModal('diary')}><Plus size={18} /></button></div>{entries.length ? entries.map(entry => <div className="food-entry" key={entry.id}><div className="food-icon"><Apple size={18} /></div><div><strong>{entry.food.name}</strong><span>{entry.grams} g · {round(entry.food.per100g.protein * entry.grams / 100)} g proteine</span></div><b>{Math.round(entry.food.per100g.kcal * entry.grams / 100)} kcal</b><button className="icon-button danger" onClick={() => removeDiaryFood(entry.id)}><Trash2 size={16} /></button></div>) : <button className="empty-meal" onClick={() => setModal('diary')}>Nessun alimento. Aggiungine uno.</button>}</section> })}</div>
          </>}

          {page === 'diete' && <>
            <section className="page-heading"><div><span className="eyebrow">PIANI NUTRIZIONALI</span><h1>Diete</h1><p>Crea, revisiona e condividi i piani con i tuoi pazienti.</p></div><button className="button primary" onClick={() => setModal('diet')}><Plus size={17} />Nuova dieta</button></section>
            <div className="diet-grid">{plans.map(plan => { const patient = patients.find(item => item.id === plan.patientId); return <article className="panel diet-card" key={plan.id}><div className="diet-card-head"><div className="diet-icon"><BookOpen size={21} /></div><span className={`badge ${plan.status === 'Pronta' ? 'success' : 'warning'}`}>{plan.status}</span></div><h3>{plan.name}</h3><p>{patient?.name ?? 'Paziente non assegnato'}</p><div className="diet-stats"><div><Flame size={16} /><strong>{plan.calories}</strong><span>kcal / giorno</span></div><div><Clock3 size={16} /><strong>{plan.updated}</strong><span>ultima modifica</span></div></div><button className="button secondary full">Apri piano <ArrowRight size={16} /></button></article> })}</div>
          </>}

          {page === 'database' && <>
            <section className="page-heading"><div><span className="eyebrow">FONTI NUTRIZIONALI</span><h1>Database alimenti</h1><p>{allFoods.length} alimenti · valori nutrizionali per 100 g</p></div><div className="heading-actions"><input ref={fileInput} type="file" accept=".json" hidden onChange={importFoods} /><button className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={17} />Importa JSON</button><button className="button primary" onClick={() => setModal('food')}><Plus size={17} />Nuovo alimento</button></div></section>
            <section className="database-toolbar"><div className="search-field"><Search size={19} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca per nome, marca o nota…" /></div><button className={`button ${onlyFavorites ? 'primary' : 'secondary'}`} onClick={() => setOnlyFavorites(!onlyFavorites)}><Star size={17} fill={onlyFavorites ? 'currentColor' : 'none'} />Preferiti</button></section>
            <div className="category-scroll"><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Tutti</button>{Object.values(FOOD_CATEGORIES).map(item => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
            <section className="panel database-panel"><div className="database-head"><span>Alimento</span><span>Valori per 100 g</span><span>Azioni</span></div>{filteredFoods.slice(0, 80).map(food => <div className="database-row" key={food.id}><div className="food-title"><div className="food-icon"><Apple size={18} /></div><div><strong>{food.name}</strong><span>{food.brand || food.note || FOOD_CATEGORIES[food.category?.toUpperCase() as keyof typeof FOOD_CATEGORIES]?.label || 'Alimento'}</span></div></div><div className="nutrition-values"><b>{food.per100g.kcal} kcal</b><span>P {food.per100g.protein}g</span><span>C {food.per100g.carbs}g</span><span>G {food.per100g.fat}g</span></div><div className="food-actions"><button className={`icon-button ${favorites.includes(food.id) ? 'favorite' : ''}`} onClick={() => toggleFavorite(food.id)}><Star size={17} fill={favorites.includes(food.id) ? 'currentColor' : 'none'} /></button><button className="icon-button add" onClick={() => addDiaryFood(food)}><Plus size={18} /></button></div></div>)}{!filteredFoods.length && <div className="empty-state"><Search size={28} /><h3>Nessun alimento trovato</h3><p>Prova a cambiare ricerca o filtri.</p></div>}</section>
          </>}

          {page === 'insights' && <>
            <section className="page-heading"><div><span className="eyebrow">ANALISI E ADERENZA</span><h1>Insight</h1><p>Trend nutrizionali e segnali utili per le prossime visite.</p></div><PatientSelect patients={patients} value={selectedPatientId} onChange={setSelectedPatientId} /></section>
            <div className="insights-grid"><section className="panel insight-hero"><span className="insight-icon"><Sparkles size={21} /></span><span className="badge success">Segnale positivo</span><h2>L’aderenza sta migliorando</h2><p>{selectedPatient.name} ha registrato pasti per 6 giorni su 7. La regolarità è cresciuta del 12% rispetto alla settimana precedente.</p><button className="text-button">Vedi il diario <ArrowRight size={15} /></button></section><section className="panel"><PanelHeader title="Obiettivi settimanali" subtitle="Percentuale media raggiunta" /><div className="chart-wrap small"><ResponsiveContainer width="100%" height="100%"><BarChart data={macroData} layout="vertical"><CartesianGrid horizontal={false} stroke="var(--border)" /><XAxis type="number" hide /><Bar dataKey="value" radius={[0, 7, 7, 0]} barSize={22} /></BarChart></ResponsiveContainer></div><div className="macro-legend">{macroData.map(item => <span key={item.name}><i style={{ background: item.fill }} />{item.name}<b>{item.value}%</b></span>)}</div></section><section className="panel wide"><PanelHeader title="Bilancio calorico" subtitle="Confronto tra calorie e obiettivo · ultimi 7 giorni" /><div className="chart-wrap large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={weeklyData}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }} /><Area type="monotone" dataKey="target" stroke="#94a3b8" strokeDasharray="5 5" fill="transparent" /><Area type="monotone" dataKey="kcal" stroke="#0f9f8f" strokeWidth={2.5} fill="#0f9f8f" fillOpacity={0.12} /></AreaChart></ResponsiveContainer></div></section></div>
          </>}

          {page === 'calendario' && <>
            <section className="page-heading"><div><span className="eyebrow">ORGANIZZAZIONE STUDIO</span><h1>Calendario</h1><p>Giovedì 29 ottobre 2026</p></div><button className="button primary"><Plus size={17} />Nuovo appuntamento</button></section>
            <section className="panel calendar-panel"><div className="calendar-day"><div className="calendar-hours">{['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'].map(hour => <div key={hour}>{hour}</div>)}</div><div className="calendar-events"><div className="calendar-event first"><strong>09:30 · Giulia Bianchi</strong><span>Visita di controllo · 45 min</span></div><div className="calendar-event second"><strong>11:00 · Marco Rossi</strong><span>Revisione piano · 30 min</span></div><div className="calendar-event third"><strong>15:30 · Elena Verdi</strong><span>Prima visita · 60 min</span></div></div></div></section>
          </>}
        </div>
      </main>

      {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null) }}><section className="modal"><button className="icon-button modal-close" onClick={() => setModal(null)}><X size={19} /></button>
        {modal === 'patient' && <><ModalTitle icon={CircleUserRound} title="Nuovo paziente" text="Crea un profilo nel nuovo spazio Vatia." /><form onSubmit={submitPatient} className="form-grid"><label className="full">Nome e cognome<input name="name" required placeholder="Es. Anna Neri" /></label><label>Età<input name="age" type="number" min="1" required placeholder="35" /></label><label>Obiettivo kcal<input name="calories" type="number" min="800" required placeholder="1900" /></label><label className="full">Obiettivo nutrizionale<input name="goal" required placeholder="Es. Perdita di peso" /></label><button className="button primary full" type="submit">Crea paziente</button></form></>}
        {modal === 'food' && <><ModalTitle icon={Apple} title="Nuovo alimento" text="Aggiungi valori nutrizionali per 100 g." /><form onSubmit={submitFood} className="form-grid"><label className="full">Nome alimento<input name="name" required /></label><label>Marca<input name="brand" /></label><label>Codice a barre<input name="barcode" /></label><label className="full">Categoria<select name="category">{Object.values(FOOD_CATEGORIES).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Kcal<input name="kcal" type="number" step="0.1" required /></label><label>Proteine (g)<input name="protein" type="number" step="0.1" required /></label><label>Carboidrati (g)<input name="carbs" type="number" step="0.1" required /></label><label>Grassi (g)<input name="fat" type="number" step="0.1" required /></label><label className="full">Nota<input name="note" placeholder="Crudo, cotto, confezione…" /></label><button className="button primary full" type="submit">Salva alimento</button></form></>}
        {modal === 'diet' && <><ModalTitle icon={BookOpen} title="Nuova dieta" text={`Piano nutrizionale per ${selectedPatient.name}.`} /><form onSubmit={submitDiet} className="form-grid"><label className="full">Nome del piano<input name="name" required placeholder="Es. Piano di mantenimento" /></label><label className="full">Obiettivo calorico giornaliero<input name="calories" type="number" min="800" defaultValue={selectedPatient.calories} required /></label><button className="button primary full" type="submit">Crea bozza</button></form></>}
        {modal === 'diary' && <DiaryPicker foods={allFoods} onAdd={addDiaryFood} />}
      </section></div>}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, note, positive }: { icon: LucideIcon; label: string; value: string; note: string; positive?: boolean }) {
  return <section className="stat-card"><div className="stat-icon"><Icon size={20} /></div><span>{label}</span><strong>{value}</strong><small className={positive ? 'positive' : ''}>{positive && <TrendingUp size={12} />}{note}</small></section>
}
function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="panel-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
}
function PatientSelect({ patients, value, onChange }: { patients: Patient[]; value: string; onChange: (id: string) => void }) {
  return <div className="select-wrap"><select value={value} onChange={event => onChange(event.target.value)}>{patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select><ChevronDown size={14} /></div>
}
function MacroRow({ label, value, target, unit, color }: { label: string; value: number; target: number; unit: string; color: string }) {
  const percent = Math.min(100, Math.round(value / target * 100))
  return <div className="macro-row"><div><span>{label}</span><strong>{round(value)} <small>/ {target} {unit}</small></strong></div><div className="macro-track"><i className={color} style={{ width: `${percent}%` }} /></div><span>{percent}%</span></div>
}
function ModalTitle({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return <div className="modal-title"><div className="modal-title-icon"><Icon size={22} /></div><h2>{title}</h2><p>{text}</p></div>
}
function DiaryPicker({ foods, onAdd }: { foods: Food[]; onAdd: (food: Food, grams?: number, meal?: Meal) => void }) {
  const [search, setSearch] = useState('')
  const [meal, setMeal] = useState<Meal>('Pranzo')
  const [grams, setGrams] = useState(100)
  const matches = foods.filter(food => food.name.toLowerCase().includes(search.toLowerCase())).slice(0, 6)
  return <><ModalTitle icon={Plus} title="Aggiungi al diario" text="Scegli alimento, pasto e quantità." /><div className="diary-picker-controls"><div className="search-field"><Search size={18} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Cerca alimento…" /></div><div className="inline-fields"><label>Pasto<select value={meal} onChange={event => setMeal(event.target.value as Meal)}>{MEALS.map(item => <option key={item}>{item}</option>)}</select></label><label>Grammi<input type="number" min="1" value={grams} onChange={event => setGrams(Number(event.target.value))} /></label></div></div><div className="diary-picker-results">{matches.map(food => <button key={food.id} onClick={() => onAdd(food, grams, meal)}><div className="food-icon"><Apple size={18} /></div><div><strong>{food.name}</strong><span>{food.per100g.kcal} kcal / 100 g</span></div><Plus size={17} /></button>)}</div></>
}
