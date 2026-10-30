import { useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronRight, Download, Info, Plus, Search, Trash2, UserRound, Utensils } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import type { DiaryEntry, Food, Patient, PlannedMeal } from '../types'
import { activePlanFor, adherenceForDays, csvDownload, dateKey, dayIndex, foodNutrition, macroGrams, mealTotals, sumNutrients } from '../lib/clinical'
import { EmptyState, Field, Modal, PatientSelect, ProgressBar } from './UI'

const MEAL_GROUPS = ['Colazione', 'Spuntino', 'Pranzo', 'Cena']
const mealGroup = (name: string) => name.toLowerCase().includes('spuntino') ? 'Spuntino' : MEAL_GROUPS.includes(name) ? name : name

export default function DiaryView({ workspace, patient, patients, onSelectPatient, onNewDiet, notify }: { workspace: Workspace; patient?: Patient; patients: Patient[]; onSelectPatient: (id: string) => void; onNewDiet: (id: string) => void; notify: (message: string) => void }) {
  const [date, setDate] = useState(new Date())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [defaultMeal, setDefaultMeal] = useState('Pranzo')
  const [copyingMeal, setCopyingMeal] = useState('')
  const key = dateKey(date)
  const activePlan = patient ? activePlanFor(workspace.plans, patient.id) : undefined
  const plannedMeals = activePlan?.plan.days[dayIndex(date)] ?? []
  const entries = workspace.diary.filter(entry => entry.patientId === patient?.id && entry.date === key)
  const foodsMap = useMemo(() => new Map(workspace.foods.map(food => [food.id, food])), [workspace.foods])
  const totals = sumNutrients(entries.flatMap(entry => { const food = foodsMap.get(entry.foodId); return food ? [{ food, grams: entry.grams }] : [] }))
  const targetKcal = activePlan?.calories ?? patient?.calories ?? 0
  const targetMacros = activePlan ? macroGrams(activePlan.calories, activePlan.plan.macroPercent) : { protein: patient?.protein ?? 0, carbs: patient?.carbs ?? 0, fat: patient?.fat ?? 0 }
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(date); day.setDate(date.getDate() - (6 - index)); const dayKey = dateKey(day)
    const dayEntries = workspace.diary.filter(entry => entry.patientId === patient?.id && entry.date === dayKey)
    const nutrients = sumNutrients(dayEntries.flatMap(entry => { const food = foodsMap.get(entry.foodId); return food ? [{ food, grams: entry.grams }] : [] }))
    return { date: day, key: dayKey, entries: dayEntries.length, kcal: nutrients.kcal, target: targetKcal }
  })
  const adherence = adherenceForDays(week)

  function shift(days: number) { const next = new Date(date); next.setDate(next.getDate() + days); setDate(next) }
  function openPicker(meal = 'Pranzo') { setDefaultMeal(meal); setPickerOpen(true) }
  async function copyPlannedGroup(group: string, groupPlans: PlannedMeal[], groupEntries: DiaryEntry[]) {
    if (!patient) return
    const plannedItems = groupPlans.flatMap(meal => meal.items.filter(item => foodsMap.has(item.foodId)).map(item => ({ ...item, mealName: meal.name })))
    if (!plannedItems.length || copyingMeal) return
    if (groupEntries.length && !window.confirm(`${group} contiene già ${groupEntries.length} registrazioni. Aggiungere comunque gli alimenti del piano?`)) return
    setCopyingMeal(group)
    try {
      await workspace.addDiaryEntries(plannedItems.map(item => ({ patientId: patient.id, date: key, foodId: item.foodId, grams: Math.max(1, Number(item.grams) || 1), meal: group, source: 'professional', note: `Copiato dal piano · ${item.mealName}` })))
      notify(`${group}: ${plannedItems.length} alimenti copiati dal piano in un’unica azione.`)
    } catch { /* errore globale */ } finally { setCopyingMeal('') }
  }
  function exportDiary() {
    if (!patient) return
    csvDownload(`diario-${patient.name.replaceAll(' ', '-')}-${key}.csv`, [['Data', 'Pasto', 'Alimento', 'Grammi', 'Kcal', 'Proteine', 'Carboidrati', 'Grassi', 'Origine', 'Note'], ...entries.map(entry => { const food = foodsMap.get(entry.foodId); const value = food ? foodNutrition(food, entry.grams) : { kcal: 0, protein: 0, carbs: 0, fat: 0 }; return [entry.date, entry.meal, food?.name ?? 'Alimento non disponibile', entry.grams, value.kcal, value.protein, value.carbs, value.fat, entry.source === 'patient' ? 'Paziente' : 'Professionista', entry.note] })])
  }

  if (!patient) return <section className="panel"><EmptyState icon={<BookOpen size={30} />} title="Nessun paziente" text="Crea un paziente per iniziare il monitoraggio alimentare." /></section>

  return <>
    <section className="page-heading"><div><span className="eyebrow">ADERENZA E FOLLOW-UP</span><h1>Diario alimentare</h1><p>Confronta ciò che è stato consumato con il piano assegnato.</p></div><div className="heading-actions"><PatientSelect patients={patients} value={patient.id} onChange={onSelectPatient} /><button className="button secondary" onClick={exportDiary}><Download size={16} />Esporta</button><button className="button primary" onClick={() => openPicker()}><Plus size={16} />Registra consumo</button></div></section>
    <section className="diary-context panel"><div className="date-switcher"><button className="icon-button" onClick={() => shift(-1)} aria-label="Giorno precedente"><ArrowLeft size={18} /></button><input aria-label="Data del diario" type="date" value={key} onChange={event => { const next = new Date(`${event.target.value}T12:00:00`); if (!Number.isNaN(next.getTime())) setDate(next) }} /><button className="icon-button" onClick={() => shift(1)} aria-label="Giorno successivo"><ArrowRight size={18} /></button><button className="text-button" onClick={() => setDate(new Date())}>Oggi</button></div><div className="diary-plan-reference"><BookOpen size={16} /><div><span>Piano di confronto</span><strong>{activePlan?.name ?? 'Nessun piano disponibile'}</strong></div>{activePlan && <span className={`badge ${activePlan.status === 'Pronta' ? 'success' : 'warning'}`}>{activePlan.status}</span>}</div></section>
    <div className="week-strip">{week.map(day => <button key={day.key} className={`${day.key === key ? 'active' : ''} ${day.entries ? 'logged' : ''}`} onClick={() => setDate(day.date)}><span>{new Intl.DateTimeFormat('it-IT', { weekday: 'short' }).format(day.date)}</span><strong>{day.date.getDate()}</strong><i>{day.entries ? `${Math.round(day.kcal)} kcal` : '—'}</i></button>)}<div className="week-adherence"><span>Aderenza nei target</span><strong>{adherence}%</strong><small>{week.filter(day => day.entries).length} giorni registrati</small></div></div>
    <section className="diary-summary comparison-summary"><NutrientComparison label="Calorie" actual={totals.kcal} target={targetKcal} unit="kcal" digits={0} /><NutrientComparison label="Proteine" actual={totals.protein} target={targetMacros.protein} unit="g" /><NutrientComparison label="Carboidrati" actual={totals.carbs} target={targetMacros.carbs} unit="g" /><NutrientComparison label="Grassi" actual={totals.fat} target={targetMacros.fat} unit="g" /></section>
    <div className="diary-explanation"><Info size={17} /><p><strong>Come leggerlo:</strong> a sinistra trovi il piano prescritto, a destra ciò che è stato effettivamente registrato. Gli scostamenti per pasto aiutano a preparare il follow-up; non implicano automaticamente un giudizio clinico.</p></div>
    {!activePlan && <section className="panel missing-plan"><AlertCircle size={23} /><div><h3>Nessun piano da confrontare</h3><p>Puoi comunque registrare il consumo. Crea un piano per vedere target e scostamenti per pasto.</p></div><button className="button primary" onClick={() => onNewDiet(patient.id)}>Crea piano<ArrowRight size={15} /></button></section>}
    <div className="diary-comparison-list">{MEAL_GROUPS.map(group => {
      const groupPlans = plannedMeals.filter(meal => mealGroup(meal.name) === group)
      const groupEntries = entries.filter(entry => mealGroup(entry.meal) === group)
      const plannedKcal = groupPlans.reduce((sum, meal) => sum + mealTotals(meal, workspace.foods).kcal, 0)
      const consumed = sumNutrients(groupEntries.flatMap(entry => { const food = foodsMap.get(entry.foodId); return food ? [{ food, grams: entry.grams }] : [] }))
      return <section className="panel diary-meal-compare" key={group}><div className="compare-header"><div><Utensils size={18} /><h2>{group}</h2></div><div><span>{Math.round(consumed.kcal)} consumate</span><b>{plannedKcal ? `/ ${Math.round(plannedKcal)} pianificate` : ''}</b><button className="icon-button add" onClick={() => openPicker(group)} aria-label={`Aggiungi a ${group}`}><Plus size={17} /></button></div></div><div className="compare-columns"><div className="planned-column"><div className="planned-column-heading"><span className="column-label">NEL PIANO</span>{plannedKcal > 0 && <button className="text-button copy-plan-button" disabled={Boolean(copyingMeal)} onClick={() => void copyPlannedGroup(group, groupPlans, groupEntries)}><CheckCircle2 size={14} />{copyingMeal === group ? 'Copia in corso…' : 'Segna come consumato'}</button>}</div>{groupPlans.length ? groupPlans.map(meal => <PlannedFoods key={meal.id} meal={meal} foodsMap={foodsMap} />) : <p className="empty-column">Nessun pasto pianificato</p>}</div><div className="consumed-column"><span className="column-label">CONSUMATO</span>{groupEntries.length ? groupEntries.map(entry => <DiaryFood key={entry.id} entry={entry} food={foodsMap.get(entry.foodId)} onDelete={() => void workspace.removeDiaryEntry(entry.id).then(() => notify('Registrazione eliminata.')).catch(() => {})} />) : <button className="empty-column add-consumed" onClick={() => openPicker(group)}><Plus size={15} />Registra il consumo</button>}</div></div>{plannedKcal > 0 && <div className="meal-delta"><ProgressBar value={consumed.kcal / plannedKcal * 100} warning={Math.abs(consumed.kcal - plannedKcal) > plannedKcal * 0.15} /><span className={Math.abs(consumed.kcal - plannedKcal) <= plannedKcal * 0.1 ? 'positive' : ''}>{consumed.kcal - plannedKcal >= 0 ? '+' : ''}{Math.round(consumed.kcal - plannedKcal)} kcal rispetto al piano</span></div>}</section>
    })}</div>
    <section className="panel diary-followup"><CheckCircle2 size={21} /><div><h3>Prepara il follow-up dai dati</h3><p>{entries.length ? `Oggi risultano ${entries.length} registrazioni. Lo scostamento calorico complessivo è ${totals.kcal - targetKcal >= 0 ? '+' : ''}${Math.round(totals.kcal - targetKcal)} kcal; verifica note e pasti prima di modificare il piano.` : 'Nessun consumo registrato in questa data. Verifica se il diario è incompleto prima di valutare l’aderenza.'}</p></div></section>
    {pickerOpen && <DiaryPicker foods={workspace.foods} defaultMeal={defaultMeal} onClose={() => setPickerOpen(false)} onAdd={async input => { try { await workspace.addDiaryEntry({ patientId: patient.id, date: key, source: 'professional', ...input }); setPickerOpen(false); notify('Consumo registrato come inserimento del professionista.') } catch { /* errore globale */ } }} />}
  </>
}

function NutrientComparison({ label, actual, target, unit, digits = 1 }: { label: string; actual: number; target: number; unit: string; digits?: number }) {
  const delta = actual - target
  return <div><span>{label}</span><strong>{actual.toFixed(digits)} <small>/ {target} {unit}</small></strong><ProgressBar value={target ? actual / target * 100 : 0} warning={target > 0 && Math.abs(delta) > target * 0.15} /><b className={target > 0 && Math.abs(delta) <= target * 0.1 ? 'positive' : ''}>{delta >= 0 ? '+' : ''}{delta.toFixed(digits)} {unit}</b></div>
}

function PlannedFoods({ meal, foodsMap }: { meal: PlannedMeal; foodsMap: Map<string, Food> }) {
  return <div className="planned-foods">{meal.items.map(item => { const food = foodsMap.get(item.foodId); return food ? <div key={item.id}><span>{food.name}</span><b>{item.grams} g</b></div> : null })}</div>
}

function DiaryFood({ entry, food, onDelete }: { entry: DiaryEntry; food?: Food; onDelete: () => void }) {
  if (!food) return null
  const value = foodNutrition(food, entry.grams)
  return <div className="diary-food"><div><strong>{food.name}</strong><span>{entry.grams} g · {Math.round(value.kcal)} kcal</span>{entry.note && <p>{entry.note}</p>}<small><UserRound size={11} />{entry.source === 'patient' ? 'Registrato dal paziente' : 'Registrato dal professionista'}</small></div><button className="icon-button danger" onClick={onDelete} aria-label={`Elimina ${food.name}`}><Trash2 size={15} /></button></div>
}

function DiaryPicker({ foods, defaultMeal, onAdd, onClose }: { foods: Food[]; defaultMeal: string; onAdd: (input: { foodId: string; grams: number; meal: string; note: string }) => Promise<void>; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [meal, setMeal] = useState(defaultMeal)
  const [grams, setGrams] = useState(100)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const matches = foods.filter(food => food.name.toLowerCase().includes(search.toLowerCase())).slice(0, 12)
  async function add(food: Food) { if (!Number.isFinite(grams) || grams < 1) return; setSaving(true); try { await onAdd({ foodId: food.id, grams, meal, note }) } finally { setSaving(false) } }
  return <Modal title="Registra il consumo" description="Inserimento manuale del professionista: aggiungi una nota se utile al follow-up." onClose={onClose}><div className="form-grid diary-entry-fields"><Field label="Pasto"><select value={meal} onChange={event => setMeal(event.target.value)}>{MEAL_GROUPS.map(item => <option key={item}>{item}</option>)}</select></Field><Field label="Quantità (g)"><input type="number" min="1" value={grams} onChange={event => setGrams(Math.max(1, Number(event.target.value) || 1))} /></Field><Field label="Nota" full><input value={note} onChange={event => setNote(event.target.value)} placeholder="Es. porzione stimata, pasto fuori casa…" /></Field></div><div className="search-field"><Search size={17} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Cerca alimento consumato…" /></div><div className="diary-picker-results">{matches.map(food => <button disabled={saving || !Number.isFinite(grams) || grams < 1} key={food.id} onClick={() => void add(food)}><div className="food-icon"><Plus size={16} /></div><div><strong>{food.name}</strong><span>{food.per100g.kcal} kcal / 100 g</span></div><ChevronRight size={16} /></button>)}</div></Modal>
}
