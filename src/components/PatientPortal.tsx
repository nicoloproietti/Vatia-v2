import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronRight, ClipboardCheck, LoaderCircle, LogOut, Plus, Search, Trash2, Utensils } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import type { DiaryEntry, Food } from '../types'
import { activePlanFor, appointmentDateKey, dateKey, dayIndex, foodNutrition, formatDate, formatDateTime, mealTotals, sumNutrients, todayKey } from '../lib/clinical'
import { DAY_NAMES, DAY_SHORT } from '../types'
import { EmptyState, Field, Modal, PatientAvatar, ProgressBar } from './UI'
import VatiaBuddy from './VatiaBuddy'
import '../patient-portal.css'

const MEAL_GROUPS = ['Colazione', 'Spuntino', 'Pranzo', 'Cena']
const mealGroup = (name: string) => name.toLowerCase().includes('spuntino') ? 'Spuntino' : name

export default function PatientPortal({ workspace, patientId, preview = false, onExit }: { workspace: Workspace; patientId: string; preview?: boolean; onExit: () => void }) {
  const [view, setView] = useState<'diary' | 'plan'>('diary')
  const [date, setDate] = useState(new Date())
  const [planDay, setPlanDay] = useState(dayIndex(new Date()))
  const [pickerMeal, setPickerMeal] = useState<string | null>(null)
  const [savingMeal, setSavingMeal] = useState('')
  const [feedback, setFeedback] = useState('')
  const patient = workspace.patients.find(item => item.id === patientId)
  const foodsMap = useMemo(() => new Map(workspace.foods.map(food => [food.id, food])), [workspace.foods])
  const key = dateKey(date)
  const readyPlans = workspace.plans.filter(plan => plan.patientId === patientId && plan.status === 'Pronta')
  const activePlan = activePlanFor(readyPlans, patientId)
  const plannedMeals = activePlan?.plan.days[dayIndex(date)] ?? []
  const entries = workspace.diary.filter(entry => entry.patientId === patientId && entry.date === key)
  const totals = sumNutrients(entries.flatMap(entry => { const food = foodsMap.get(entry.foodId); return food ? [{ food, grams: entry.grams }] : [] }))
  const nextAppointment = workspace.appointments.filter(item => item.patientId === patientId && appointmentDateKey(item.startsAt) >= todayKey()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]

  function shift(days: number) { const next = new Date(date); next.setDate(next.getDate() + days); setDate(next) }
  function plannedFor(group: string) {
    return plannedMeals.filter(meal => mealGroup(meal.name) === group).flatMap(meal => meal.items.filter(item => foodsMap.has(item.foodId)).map(item => ({ ...item, mealName: meal.name })))
  }
  async function confirmGroup(group: string) {
    const planned = plannedFor(group)
    const existing = entries.filter(entry => mealGroup(entry.meal) === group)
    if (!planned.length || existing.length || savingMeal) return
    setSavingMeal(group); setFeedback('')
    try {
      await workspace.addDiaryEntries(planned.map(item => ({ patientId, date: key, foodId: item.foodId, grams: Math.max(1, Number(item.grams) || 1), meal: group, source: 'patient', note: `Confermato dal piano · ${item.mealName}` })))
      setFeedback(`${group}: pasto confermato e inviato al professionista.`)
    } catch { /* errore globale */ } finally { setSavingMeal('') }
  }
  async function addEntry(input: { foodId: string; grams: number; meal: string; note: string }) {
    await workspace.addDiaryEntry({ patientId, date: key, source: 'patient', ...input })
    setPickerMeal(null); setFeedback('Alimento aggiunto al tuo diario.')
  }

  if (!patient) return <main className="patient-shell"><section className="panel"><EmptyState icon={<BookOpen size={30} />} title="Area non disponibile" text="Il collegamento con la scheda paziente non è attivo." action={<button className="button secondary" onClick={onExit}>Torna all’accesso</button>} /></section></main>

  return <div className="patient-shell">
    <header className="patient-topbar"><div className="brand"><VatiaBuddy size={40} className="brand-buddy" /><span>vatia</span><small>PER TE</small></div><div className="patient-top-actions">{preview && <span className="badge warning">Anteprima</span>}<PatientAvatar patient={patient} /><button className="icon-button" onClick={onExit} aria-label={preview ? 'Chiudi anteprima' : 'Esci dall’area paziente'}><LogOut size={18} /></button></div></header>
    <main className="patient-main">
      {preview && <div className="patient-preview-note"><CheckCircle2 size={17} /><span>Anteprima del professionista: le azioni salvano dati locali nel browser ospite.</span></div>}
      <section className="patient-welcome"><div><span className="eyebrow">IL TUO PERCORSO</span><h1>Ciao, {patient.name.split(' ')[0]}.</h1><p>Segui il piano e registra ciò che mangi: il professionista vedrà il diario aggiornato.</p></div><div className="patient-next"><CalendarDays size={20} /><div><span>Prossimo appuntamento</span><strong>{nextAppointment ? formatDateTime(nextAppointment.startsAt) : 'Non programmato'}</strong></div></div></section>
      <nav className="patient-nav" aria-label="Area paziente"><button className={view === 'diary' ? 'active' : ''} onClick={() => setView('diary')}><ClipboardCheck size={18} />Il mio diario</button><button className={view === 'plan' ? 'active' : ''} onClick={() => setView('plan')}><BookOpen size={18} />Il mio piano</button></nav>
      {workspace.error && <p className="voice-feedback error" role="alert">{workspace.error}</p>}
      {feedback && <p className="patient-feedback" role="status"><CheckCircle2 size={17} />{feedback}</p>}
      {view === 'diary' ? <>
        <section className="patient-date panel"><button className="icon-button" onClick={() => shift(-1)} aria-label="Giorno precedente"><ArrowLeft size={18} /></button><div><span>Diario di</span><input aria-label="Data del diario paziente" type="date" value={key} onChange={event => { if (event.target.value) setDate(new Date(`${event.target.value}T12:00:00`)) }} /></div><button className="icon-button" onClick={() => shift(1)} aria-label="Giorno successivo"><ArrowRight size={18} /></button><button className="text-button" onClick={() => setDate(new Date())}>Oggi</button></section>
        <section className="patient-day-summary panel"><div><span>Consumate</span><strong>{Math.round(totals.kcal)} <small>/ {activePlan?.calories ?? patient.calories ?? 0} kcal</small></strong><ProgressBar value={(activePlan?.calories ?? patient.calories) ? totals.kcal / (activePlan?.calories ?? patient.calories) * 100 : 0} /></div><div><span>Proteine</span><strong>{totals.protein.toFixed(1)} g</strong></div><div><span>Carboidrati</span><strong>{totals.carbs.toFixed(1)} g</strong></div><div><span>Grassi</span><strong>{totals.fat.toFixed(1)} g</strong></div></section>
        {!activePlan && <section className="panel"><EmptyState icon={<BookOpen size={28} />} title="Il piano non è ancora disponibile" text="Puoi comunque registrare i pasti. Quando il professionista segnerà il piano come pronto, lo troverai qui." /></section>}
        <div className="patient-meals">{MEAL_GROUPS.map(group => {
          const planned = plannedFor(group)
          const groupEntries = entries.filter(entry => mealGroup(entry.meal) === group)
          const consumed = sumNutrients(groupEntries.flatMap(entry => { const food = foodsMap.get(entry.foodId); return food ? [{ food, grams: entry.grams }] : [] }))
          return <section className="panel patient-meal" key={group}><div className="patient-meal-head"><div><Utensils size={18} /><h2>{group}</h2></div><span>{Math.round(consumed.kcal)} kcal</span></div>
            {planned.length > 0 && <div className="patient-planned"><span className="column-label">NEL TUO PIANO</span>{planned.map(item => <div key={`${item.mealName}-${item.id}`}><span>{foodsMap.get(item.foodId)?.name}</span><b>{item.grams} g</b></div>)}<button className="button secondary full" disabled={Boolean(groupEntries.length) || Boolean(savingMeal)} title={groupEntries.length ? 'Il pasto contiene già registrazioni' : 'Copia alimenti e quantità del piano'} onClick={() => void confirmGroup(group)}>{savingMeal === group ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{groupEntries.length ? 'Pasto già registrato' : savingMeal === group ? 'Conferma in corso…' : 'Ho seguito il piano'}</button></div>}
            <div className="patient-consumed"><span className="column-label">COSA HAI MANGIATO</span>{groupEntries.length ? groupEntries.map(entry => <PatientDiaryFood key={entry.id} entry={entry} food={foodsMap.get(entry.foodId)} onUpdate={async grams => { await workspace.updateDiaryEntry({ ...entry, grams }); setFeedback('Quantità aggiornata.') }} onDelete={async () => { await workspace.removeDiaryEntry(entry.id); setFeedback('Registrazione eliminata.') }} />) : <p className="muted-block">Nessun alimento registrato.</p>}<button className="patient-add-food" onClick={() => setPickerMeal(group)}><Plus size={16} />Aggiungi alimento</button></div>
          </section>
        })}</div>
      </> : <section className="patient-plan-view"><div className="section-toolbar"><div><h2>{activePlan?.name ?? 'Piano non disponibile'}</h2><p>{activePlan ? `${activePlan.calories} kcal al giorno · aggiornato il ${formatDate(activePlan.updatedAt.slice(0, 10))}` : 'Il professionista non ha ancora pubblicato un piano.'}</p></div></div>{activePlan && <><div className="patient-plan-days">{DAY_SHORT.map((day, index) => <button className={planDay === index ? 'active' : ''} key={day} onClick={() => setPlanDay(index)}>{day}</button>)}</div><h3 className="patient-plan-day-title">{DAY_NAMES[planDay]}</h3><div className="patient-plan-meals">{(activePlan.plan.days[planDay] ?? []).map(meal => <section className="panel" key={meal.id}><div className="panel-header"><div><h3>{meal.name}</h3><p>{Math.round(mealTotals(meal, workspace.foods).kcal)} kcal</p></div></div>{meal.items.length ? meal.items.map(item => { const food = foodsMap.get(item.foodId); return food ? <div className="patient-plan-food" key={item.id}><span>{food.name}</span><b>{item.grams} g</b></div> : null }) : <p className="muted-block">Pasto non composto.</p>}</section>)}</div></>}</section>}
    </main>
    {pickerMeal && <PatientFoodPicker foods={workspace.foods} meal={pickerMeal} onClose={() => setPickerMeal(null)} onAdd={addEntry} />}
  </div>
}

function PatientDiaryFood({ entry, food, onUpdate, onDelete }: { entry: DiaryEntry; food?: Food; onUpdate: (grams: number) => Promise<void>; onDelete: () => Promise<void> }) {
  const [grams, setGrams] = useState(String(entry.grams))
  const [busy, setBusy] = useState(false)
  if (!food) return null
  const numericGrams = Number(grams)
  const valid = Number.isFinite(numericGrams) && numericGrams >= 1
  const changed = valid && numericGrams !== entry.grams
  const value = foodNutrition(food, valid ? numericGrams : entry.grams)
  async function run(action: () => Promise<void>) { setBusy(true); try { await action() } catch { /* errore globale */ } finally { setBusy(false) } }
  return <div className="patient-diary-food"><div className="patient-diary-food-title"><strong>{food.name}</strong><span>{Math.round(value.kcal)} kcal{entry.source === 'professional' ? ' · inserito dal professionista' : ''}</span>{entry.note && <small>{entry.note}</small>}</div>{entry.source === 'patient' ? <div className="patient-entry-actions"><label><input aria-label={`Grammi di ${food.name}`} type="number" min="1" value={grams} onChange={event => setGrams(event.target.value)} /><span>g</span></label>{changed && <button className="icon-button" disabled={busy} onClick={() => void run(() => onUpdate(numericGrams))} aria-label={`Salva quantità di ${food.name}`}><Check size={15} /></button>}<button className="icon-button danger" disabled={busy} onClick={() => void run(onDelete)} aria-label={`Elimina ${food.name}`}><Trash2 size={15} /></button></div> : <b>{entry.grams} g</b>}</div>
}

function PatientFoodPicker({ foods, meal, onAdd, onClose }: { foods: Food[]; meal: string; onAdd: (input: { foodId: string; grams: number; meal: string; note: string }) => Promise<void>; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [grams, setGrams] = useState(100)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const matches = foods.filter(food => !food.isLegacy && food.name.toLowerCase().includes(search.toLowerCase())).slice(0, 12)
  async function add(food: Food) {
    if (!Number.isFinite(grams) || grams < 1) return
    setSaving(true)
    try { await onAdd({ foodId: food.id, grams, meal, note }) } catch { /* errore globale */ } finally { setSaving(false) }
  }
  return <Modal title={`Aggiungi a ${meal}`} description="Cerca l’alimento, indica la quantità effettiva e aggiungi una nota se utile." onClose={onClose}><div className="form-grid diary-entry-fields"><Field label="Quantità (g)"><input type="number" min="1" value={grams} onChange={event => setGrams(Math.max(1, Number(event.target.value) || 1))} /></Field><Field label="Nota" full><input value={note} onChange={event => setNote(event.target.value)} placeholder="Es. porzione stimata, pasto fuori casa…" /></Field></div><div className="search-field"><Search size={17} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Cerca alimento…" aria-label="Cerca alimento per il diario" /></div><div className="diary-picker-results">{matches.map(food => <button disabled={saving || !Number.isFinite(grams) || grams < 1} key={food.id} onClick={() => void add(food)}><div className="food-icon"><Plus size={16} /></div><div><strong>{food.name}</strong><span>{food.per100g.kcal} kcal / 100 g</span></div><ChevronRight size={16} /></button>)}</div></Modal>
}
