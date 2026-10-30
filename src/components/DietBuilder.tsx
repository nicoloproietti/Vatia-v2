import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, BookOpen, Check, CheckCircle2, Copy, Download, ListChecks, Minus, Plus, Printer, RefreshCw, Search, ShoppingBag, Sparkles, Target, Trash2, Utensils, WandSparkles } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import type { DietPlan, Food, Nutrients, Patient, PlannedMeal, PlanItem } from '../types'
import { DAY_NAMES, DAY_SHORT, DEFAULT_MEAL_NAMES } from '../types'
import { calculateBMR, calculateTDEE, csvDownload, dayTotals, defaultSplit, foodNutrition, formatDate, macroGrams, mealTotals, round, uid } from '../lib/clinical'
import { equivalentGrams, isFoodSuitable, mealStructureWarnings, optimizeItems, quickMealItems } from '../lib/dietEngine'
import { EmptyState, Field, Modal, ProgressBar } from './UI'

type Picker = { mealIndex: number } | null
type Substitution = { mealIndex: number; item: PlanItem } | null

export default function DietBuilder({ workspace, plan: sourcePlan, patient, onBack, onDirtyChange, notify }: { workspace: Workspace; plan: DietPlan; patient: Patient; onBack: () => void; onDirtyChange: (dirty: boolean) => void; notify: (message: string) => void }) {
  const [plan, setPlan] = useState<DietPlan>(() => structuredClone(sourcePlan))
  const [activeDay, setActiveDay] = useState(0)
  const [picker, setPicker] = useState<Picker>(null)
  const [substitution, setSubstitution] = useState<Substitution>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const foodsMap = useMemo(() => new Map(workspace.foods.map(food => [food.id, food])), [workspace.foods])
  const meals = plan.plan.days[activeDay] ?? []
  const totals = dayTotals(meals, workspace.foods)
  const targets = macroGrams(plan.calories, plan.plan.macroPercent)
  const bmr = calculateBMR(patient.weight, patient.height, patient.age, patient.sex)
  const tdee = calculateTDEE(patient)
  const kcalPctTotal = plan.plan.kcalPct.reduce((sum, value) => sum + value, 0)
  const macroTotal = Object.values(plan.plan.macroPercent).reduce((sum, value) => sum + value, 0)
  const configuredDays = Object.values(plan.plan.days).filter(day => day.length && day.every(meal => meal.items.length)).length
  const completedMeals = meals.filter(meal => meal.items.length).length
  const calorieDelta = totals.kcal - plan.calories

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  function update(next: DietPlan) { setPlan(next); setDirty(true) }
  function updateDay(dayMeals: PlannedMeal[], day = activeDay) { update({ ...plan, plan: { ...plan.plan, days: { ...plan.plan.days, [day]: dayMeals } } }) }
  function updateMeal(index: number, meal: PlannedMeal) { updateDay(meals.map((item, mealIndex) => mealIndex === index ? meal : item)) }

  function changeCalories(calories: number) { update({ ...plan, calories: Number.isFinite(calories) ? Math.min(10000, Math.max(800, calories)) : 800 }) }
  function changeMealCount(count: number) {
    if (count === plan.plan.kcalPct.length) return
    const hasFoods = Object.values(plan.plan.days).some(day => day.some(meal => meal.items.length))
    if (hasFoods && !window.confirm('Cambiare il numero di pasti in tutta la settimana? La distribuzione verrà ricalcolata; gli alimenti dei pasti con lo stesso indice verranno mantenuti.')) return
    const kcalPct = defaultSplit(count)
    const days = Object.fromEntries(Array.from({ length: 7 }, (_, day) => {
      const previous = plan.plan.days[day] ?? []
      return [day, DEFAULT_MEAL_NAMES[count].map((name, index) => ({ id: previous[index]?.id ?? uid(), name, items: previous[index]?.items ?? [] }))]
    }))
    update({ ...plan, plan: { ...plan.plan, kcalPct, days } })
  }

  function quickCompose(index: number) {
    const meal = meals[index]
    if (meal.items.length && !window.confirm(`Sostituire gli alimenti di ${meal.name} con una composizione rapida?`)) return
    const items = quickMealItems(meal.name, workspace.foods)
    if (!items.length) { notify('Aggiungi prima alcuni alimenti al database.'); return }
    const target = mealTarget(index)
    updateMeal(index, { ...meal, items: optimizeItems(items, workspace.foods, target.kcal, target) })
  }

  function optimize(index: number) {
    const meal = meals[index]
    if (!meal.items.length) { quickCompose(index); return }
    const target = mealTarget(index)
    updateMeal(index, { ...meal, items: optimizeItems(meal.items, workspace.foods, target.kcal, target) })
    notify(`${meal.name}: quantità ottimizzate con il motore Vatia.`)
  }

  function optimizeDay() {
    if (!meals.length) return
    const next = meals.map((meal, index) => {
      const items = meal.items.length ? meal.items : quickMealItems(meal.name, workspace.foods)
      const target = mealTarget(index)
      return { ...meal, items: optimizeItems(items, workspace.foods, target.kcal, target) }
    })
    updateDay(next); notify('Giornata composta e ottimizzata. Controlla grammi e alternative prima di segnarla come pronta.')
  }

  function mealTarget(index: number): Nutrients {
    const kcal = Math.round(plan.calories * (plan.plan.kcalPct[index] ?? 0) / 100)
    return { kcal, ...macroGrams(kcal, plan.plan.macroPercent) }
  }

  function addFood(food: Food) {
    if (!picker) return
    const meal = meals[picker.mealIndex]
    const existing = meal.items.find(item => item.foodId === food.id)
    const items = existing ? meal.items.map(item => item.id === existing.id ? { ...item, grams: item.grams + 50 } : item) : [...meal.items, { id: uid(), foodId: food.id, grams: food.category === 'verdure' ? 200 : 100 }]
    updateMeal(picker.mealIndex, { ...meal, items }); setPicker(null)
  }

  function substitute(food: Food) {
    if (!substitution) return
    const original = foodsMap.get(substitution.item.foodId)
    const meal = meals[substitution.mealIndex]
    const grams = original ? equivalentGrams(original, food, substitution.item.grams) : substitution.item.grams
    updateMeal(substitution.mealIndex, { ...meal, items: meal.items.map(item => item.id === substitution.item.id ? { ...item, foodId: food.id, grams } : item) })
    setSubstitution(null); notify('Alimento sostituito mantenendo un equivalente calorico.')
  }

  function copyMealToWeek(index: number) {
    if (!window.confirm(`Copiare ${meals[index].name} in tutti i giorni della settimana?`)) return
    const days = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, (plan.plan.days[day] ?? []).map((meal, mealIndex) => mealIndex === index ? { ...meal, items: meals[index].items.map(item => ({ ...item, id: uid() })) } : meal)]))
    update({ ...plan, plan: { ...plan.plan, days } }); notify('Pasto copiato in tutta la settimana.')
  }

  function copyDay(targets: number[]) {
    const days = { ...plan.plan.days }
    targets.forEach(day => { days[day] = meals.map(meal => ({ ...meal, id: uid(), items: meal.items.map(item => ({ ...item, id: uid() })) })) })
    update({ ...plan, plan: { ...plan.plan, days } }); setCopyOpen(false); notify(`Giornata copiata in ${targets.length} ${targets.length === 1 ? 'giorno' : 'giorni'}.`)
  }

  async function save(status = plan.status) {
    if (!plan.name.trim()) { notify('Assegna un nome al piano prima di salvarlo.'); return }
    if (status === 'Pronta' && (kcalPctTotal !== 100 || macroTotal !== 100)) { notify('Per segnare il piano come pronto, calorie e macronutrienti devono essere distribuiti al 100%.'); return }
    if (status === 'Pronta' && !configuredDays) { notify('Componi almeno una giornata completa prima di segnare il piano come pronto.'); return }
    setSaving(true)
    try {
      const saved = await workspace.saveDiet({ ...plan, status, updatedAt: new Date().toISOString() })
      setPlan(structuredClone(saved)); setDirty(false); notify(status === 'Pronta' ? 'Piano salvato e pronto per il paziente.' : 'Bozza salvata.')
    } catch { /* errore globale */ } finally { setSaving(false) }
  }

  function back() { if (!dirty || window.confirm('Uscire dal builder? Le modifiche non salvate andranno perse.')) onBack() }

  return <div className="diet-builder">
    <section className="builder-heading"><div><button className="text-button builder-back" onClick={back}><ArrowLeft size={16} />Tutte le diete</button><span className="eyebrow">BUILDER NUTRIZIONALE · {patient.name}</span><input className="plan-name-input" aria-label="Nome del piano" value={plan.name} onChange={event => update({ ...plan, name: event.target.value })} /><p>{patient.goal} · {patient.weight} kg · {patient.height} cm</p></div><div className="builder-actions"><span className={`save-state ${dirty ? 'dirty' : ''}`}>{dirty ? 'Modifiche non salvate' : 'Tutto salvato'}</span><button className="button secondary" onClick={() => setPreviewOpen(true)}><BookOpen size={16} />Anteprima</button><button className="button secondary" disabled={saving} onClick={() => void save('Bozza')}>Salva bozza</button><button className="button primary" disabled={saving} onClick={() => void save('Pronta')}><Check size={16} />{saving ? 'Salvataggio…' : 'Segna come pronta'}</button></div></section>

    <div className="builder-layout">
      <aside className="builder-settings">
        <section className="panel settings-section"><div className="settings-title"><span>1</span><div><h2>Fabbisogno e obiettivo</h2><p>Calcolato dai dati del paziente</p></div></div><div className="metabolic-mini"><div><span>BMR</span><strong>{bmr || '—'} kcal</strong></div><div><span>TDEE</span><strong>{tdee || '—'} kcal</strong></div></div><div className="objective-buttons">{([['Dimagrimento', 0.85], ['Mantenimento', 1], ['Massa', 1.1]] as const).map(([label, factor]) => <button key={label} className={plan.calories === Math.round(tdee * factor) ? 'active' : ''} onClick={() => changeCalories(Math.round(tdee * factor))}>{label}<span>{Math.round(tdee * factor)} kcal</span></button>)}</div><Field label="Target giornaliero"><div className="unit-input"><input type="number" min="800" step="10" value={plan.calories} onChange={event => changeCalories(Number(event.target.value))} /><span>kcal</span></div></Field></section>

        <section className="panel settings-section"><div className="settings-title"><span>2</span><div><h2>Macronutrienti</h2><p>Distribuzione energetica</p></div></div><div className="macro-percent-grid">{(['protein', 'carbs', 'fat'] as const).map(key => <label key={key}><span>{key === 'protein' ? 'Proteine' : key === 'carbs' ? 'Carboidrati' : 'Grassi'}</span><div><input type="number" min="0" max="100" value={plan.plan.macroPercent[key]} onChange={event => update({ ...plan, plan: { ...plan.plan, macroPercent: { ...plan.plan.macroPercent, [key]: Number(event.target.value) } } })} /><b>%</b></div><small>{targets[key]} g</small></label>)}</div><div className={`distribution-check ${macroTotal === 100 ? 'valid' : 'invalid'}`}>{macroTotal === 100 ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{macroTotal}% distribuito<button onClick={() => update({ ...plan, plan: { ...plan.plan, macroPercent: { protein: 30, carbs: 40, fat: 30 } } })}>30 / 40 / 30</button></div></section>

        <section className="panel settings-section"><div className="settings-title"><span>3</span><div><h2>Struttura dei pasti</h2><p>Da 2 a 6 momenti al giorno</p></div></div><div className="meal-count-selector">{[2, 3, 4, 5, 6].map(count => <button key={count} className={meals.length === count ? 'active' : ''} onClick={() => changeMealCount(count)}>{count}</button>)}</div><div className="meal-distribution">{meals.map((meal, index) => <label key={meal.id}><span>{meal.name}</span><div><input type="number" min="0" max="100" value={plan.plan.kcalPct[index] ?? 0} onChange={event => { const kcalPct = plan.plan.kcalPct.map((value, itemIndex) => itemIndex === index ? Number(event.target.value) : value); update({ ...plan, plan: { ...plan.plan, kcalPct } }) }} /><b>%</b><small>{mealTarget(index).kcal} kcal</small></div></label>)}</div><div className={`distribution-check ${kcalPctTotal === 100 ? 'valid' : 'invalid'}`}>{kcalPctTotal === 100 ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{kcalPctTotal}% delle calorie</div></section>
      </aside>

      <main className="builder-main">
        <section className="panel builder-day-panel"><div className="day-tabs">{DAY_SHORT.map((day, index) => { const count = (plan.plan.days[index] ?? []).filter(meal => meal.items.length).length; return <button key={day} className={`${activeDay === index ? 'active' : ''} ${count === meals.length ? 'complete' : ''}`} onClick={() => setActiveDay(index)}><span>{day}</span><i>{count}/{meals.length}</i></button> })}</div><div className="day-toolbar"><div><h2>{DAY_NAMES[activeDay]}</h2><p>{completedMeals} di {meals.length} pasti composti · {configuredDays} giorni completi</p></div><div><button className="button secondary" disabled={!completedMeals} onClick={() => setCopyOpen(true)}><Copy size={15} />Copia giorno</button><button className="button primary" onClick={optimizeDay}><WandSparkles size={16} />Componi e ottimizza</button></div></div>
          <div className="builder-meals">{meals.map((meal, index) => <MealEditor key={meal.id} meal={meal} index={index} target={mealTarget(index)} foods={workspace.foods} foodsMap={foodsMap} onAdd={() => setPicker({ mealIndex: index })} onOptimize={() => optimize(index)} onQuick={() => quickCompose(index)} onCopy={() => copyMealToWeek(index)} onChange={next => updateMeal(index, next)} onSubstitute={item => setSubstitution({ mealIndex: index, item })} />)}</div>
        </section>
      </main>

      <aside className="builder-summary"><section className="panel daily-target"><div className="panel-header"><div><h2>Bilancio giornaliero</h2><p>Reale rispetto al target</p></div><Target size={18} /></div><div className="calorie-balance"><div><strong>{Math.round(totals.kcal)}</strong><span>/ {plan.calories} kcal</span></div><b className={Math.abs(calorieDelta) <= plan.calories * 0.05 ? 'positive' : ''}>{calorieDelta > 0 ? '+' : ''}{Math.round(calorieDelta)} kcal</b></div><ProgressBar value={plan.calories ? totals.kcal / plan.calories * 100 : 0} warning={Math.abs(calorieDelta) > plan.calories * 0.1} /><div className="summary-macros">{([['Proteine', 'protein'], ['Carboidrati', 'carbs'], ['Grassi', 'fat']] as const).map(([label, key]) => <div key={key}><span>{label}</span><strong>{round(totals[key])} <small>/ {targets[key]} g</small></strong><ProgressBar value={targets[key] ? totals[key] / targets[key] * 100 : 0} /></div>)}</div></section><section className="panel readiness-card"><div className="settings-title"><ListChecks size={19} /><div><h2>Controllo piano</h2><p>Prima della consegna</p></div></div><CheckRow ok={kcalPctTotal === 100 && macroTotal === 100} text="Target e distribuzioni al 100%" /><CheckRow ok={completedMeals === meals.length} text={`${completedMeals}/${meals.length} pasti composti oggi`} /><CheckRow ok={Math.abs(calorieDelta) <= plan.calories * 0.1} text="Calorie entro il 10% dal target" /><CheckRow ok={configuredDays > 0} text={`${configuredDays} giornate complete`} /><p className="clinical-disclaimer">Il controllo numerico supporta, non sostituisce, la valutazione professionale.</p></section></aside>
    </div>

    {picker && <FoodPicker foods={workspace.foods} mealName={meals[picker.mealIndex].name} onAdd={addFood} onClose={() => setPicker(null)} />}
    {substitution && <SubstitutionPicker foods={workspace.foods} original={foodsMap.get(substitution.item.foodId)} mealName={meals[substitution.mealIndex].name} onSelect={substitute} onClose={() => setSubstitution(null)} />}
    {copyOpen && <CopyDayModal activeDay={activeDay} onCopy={copyDay} onClose={() => setCopyOpen(false)} />}
    {previewOpen && <PlanPreview plan={plan} patient={patient} foods={workspace.foods} onClose={() => setPreviewOpen(false)} />}
  </div>
}

function MealEditor({ meal, index, target, foods, foodsMap, onAdd, onOptimize, onQuick, onCopy, onChange, onSubstitute }: { meal: PlannedMeal; index: number; target: Nutrients; foods: Food[]; foodsMap: Map<string, Food>; onAdd: () => void; onOptimize: () => void; onQuick: () => void; onCopy: () => void; onChange: (meal: PlannedMeal) => void; onSubstitute: (item: PlanItem) => void }) {
  const totals = mealTotals(meal, foods)
  const warnings = mealStructureWarnings(meal.name, meal.items, foods)
  return <section className="meal-editor"><div className="meal-editor-header"><div className="meal-number">{index + 1}</div><div><h3>{meal.name}</h3><p>Target {target.kcal} kcal · P {target.protein} g · C {target.carbs} g · G {target.fat} g</p></div><div className="meal-actual"><strong>{Math.round(totals.kcal)} kcal</strong><span>{totals.kcal - target.kcal >= 0 ? '+' : ''}{Math.round(totals.kcal - target.kcal)} dal target</span></div><button className="icon-button" title="Copia pasto in tutta la settimana" disabled={!meal.items.length} onClick={onCopy}><Copy size={16} /></button><button className="button secondary" onClick={onOptimize}><Sparkles size={15} />Ottimizza</button></div>{meal.items.length ? <div className="plan-food-list">{meal.items.map(item => { const food = foodsMap.get(item.foodId); if (!food) return null; const nutrition = foodNutrition(food, item.grams); return <div className="plan-food-row" key={item.id}><div className="food-icon"><Utensils size={16} /></div><div className="plan-food-name"><strong>{food.name}</strong><span>{food.note || food.category}{food.brand ? ` · ${food.brand}` : ''}</span></div><div className="grams-input"><input aria-label={`Grammi ${food.name}`} type="number" min="1" value={item.grams} onChange={event => onChange({ ...meal, items: meal.items.map(candidate => candidate.id === item.id ? { ...candidate, grams: Math.max(1, Number(event.target.value) || 1) } : candidate) })} /><span>g</span></div><div className="plan-food-macros"><strong>{Math.round(nutrition.kcal)} kcal</strong><span>P {round(nutrition.protein)} · C {round(nutrition.carbs)} · G {round(nutrition.fat)}</span></div><button className="icon-button" title="Sostituisci con alternativa equivalente" onClick={() => onSubstitute(item)}><RefreshCw size={15} /></button><button className="icon-button danger" title="Rimuovi alimento" onClick={() => onChange({ ...meal, items: meal.items.filter(candidate => candidate.id !== item.id) })}><Trash2 size={15} /></button></div>})}</div> : <button className="quick-empty" onClick={onQuick}><WandSparkles size={21} /><strong>Componi questo pasto</strong><span>Una base equilibrata, ottimizzata sul target. Poi modifichi tutto.</span></button>}{warnings.length > 0 && <div className="meal-warning"><AlertCircle size={14} />{warnings.join(' · ')}</div>}<button className="add-food-row" onClick={onAdd}><Plus size={15} />Aggiungi alimento</button></section>
}

function FoodPicker({ foods, mealName, onAdd, onClose }: { foods: Food[]; mealName: string; onAdd: (food: Food) => void; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const categories = [...new Set(foods.map(food => food.category))].sort()
  const matches = foods.filter(food => isFoodSuitable(food, mealName) && food.name.toLowerCase().includes(search.toLowerCase()) && (category === 'all' || food.category === category)).slice(0, 40)
  return <Modal title={`Aggiungi a ${mealName}`} description="Cerca nel database e aggiungi: i grammi restano modificabili." onClose={onClose} wide><div className="picker-toolbar"><div className="search-field"><Search size={17} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Cerca alimento…" /></div><select aria-label="Filtra categoria" value={category} onChange={event => setCategory(event.target.value)}><option value="all">Tutte le categorie</option>{categories.map(item => <option key={item}>{item}</option>)}</select></div><div className="food-picker-list">{matches.map(food => <button key={food.id} onClick={() => onAdd(food)}><div className="food-icon"><Plus size={16} /></div><div><strong>{food.name}</strong><span>{food.note || food.category} · P {food.per100g.protein} · C {food.per100g.carbs} · G {food.per100g.fat}</span></div><b>{food.per100g.kcal} kcal<small>/ 100 g</small></b></button>)}{!matches.length && <EmptyState icon={<Search size={25} />} title="Nessun alimento" text="Prova un’altra ricerca o cambia categoria." />}</div></Modal>
}

function SubstitutionPicker({ foods, original, mealName, onSelect, onClose }: { foods: Food[]; original?: Food; mealName: string; onSelect: (food: Food) => void; onClose: () => void }) {
  const alternatives = original ? foods.filter(food => food.id !== original.id && food.category === original.category && isFoodSuitable(food, mealName)) : []
  return <Modal title={`Alternativa a ${original?.name ?? 'alimento'}`} description="La quantità verrà ricalcolata a parità di calorie." onClose={onClose}><div className="food-picker-list">{alternatives.map(food => <button key={food.id} onClick={() => onSelect(food)}><div className="food-icon"><RefreshCw size={16} /></div><div><strong>{food.name}</strong><span>{food.note || food.category}</span></div><b>{food.per100g.kcal} kcal<small>/ 100 g</small></b></button>)}{!alternatives.length && <EmptyState icon={<RefreshCw size={25} />} title="Nessuna alternativa" text="Non ci sono altri alimenti compatibili nella stessa categoria." />}</div></Modal>
}

function CopyDayModal({ activeDay, onCopy, onClose }: { activeDay: number; onCopy: (days: number[]) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<number[]>(DAY_NAMES.map((_, index) => index).filter(index => index !== activeDay))
  const toggle = (day: number) => setSelected(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day])
  return <Modal title={`Copia ${DAY_NAMES[activeDay]}`} description="Scegli i giorni da sovrascrivere con pasti, alimenti e quantità di questa giornata." onClose={onClose}><div className="copy-day-grid">{DAY_NAMES.map((day, index) => <button key={day} disabled={index === activeDay} className={selected.includes(index) ? 'active' : ''} onClick={() => toggle(index)}><span>{selected.includes(index) ? <Check size={15} /> : index === activeDay ? <Minus size={15} /> : null}</span>{day}</button>)}</div><button className="button primary full" disabled={!selected.length} onClick={() => onCopy(selected)}>Copia in {selected.length} {selected.length === 1 ? 'giorno' : 'giorni'}</button></Modal>
}

function PlanPreview({ plan, patient, foods, onClose }: { plan: DietPlan; patient: Patient; foods: Food[]; onClose: () => void }) {
  const [tab, setTab] = useState<'week' | 'shopping'>('week')
  const [day, setDay] = useState(0)
  const [checked, setChecked] = useState<string[]>([])
  const foodsMap = new Map(foods.map(food => [food.id, food]))
  const shopping = new Map<string, { food: Food; grams: number }>()
  Object.values(plan.plan.days).forEach(meals => meals.forEach(meal => meal.items.forEach(item => { const food = foodsMap.get(item.foodId); if (food) shopping.set(food.id, { food, grams: (shopping.get(food.id)?.grams ?? 0) + item.grams }) })))
  const shoppingRows = [...shopping.values()].sort((a, b) => a.food.category.localeCompare(b.food.category) || a.food.name.localeCompare(b.food.name))
  const categories = [...new Set(shoppingRows.map(row => row.food.category))]
  function exportPlan() {
    const rows: (string | number)[][] = [['Giorno', 'Pasto', 'Alimento', 'Grammi', 'Kcal', 'Proteine', 'Carboidrati', 'Grassi']]
    Object.entries(plan.plan.days).forEach(([dayIndex, meals]) => meals.forEach(meal => meal.items.forEach(item => { const food = foodsMap.get(item.foodId); if (!food) return; const value = foodNutrition(food, item.grams); rows.push([DAY_NAMES[Number(dayIndex)], meal.name, food.name, item.grams, value.kcal, value.protein, value.carbs, value.fat]) })))
    csvDownload(`${plan.name.replaceAll(' ', '-')}.csv`, rows)
  }
  function toggleChecked(id: string) { setChecked(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]) }
  return <Modal title={plan.name} description={`${patient.name} · ${plan.calories} kcal / giorno · ${plan.status}`} onClose={onClose} wide>
    <div className="preview-actions no-print"><div className="record-tabs"><button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')}>Piano settimanale</button><button className={tab === 'shopping' ? 'active' : ''} onClick={() => setTab('shopping')}><ShoppingBag size={14} />Lista spesa</button></div><div><button className="button secondary" onClick={exportPlan}><Download size={15} />CSV</button><button className="button primary" onClick={() => window.print()}><Printer size={15} />Stampa / PDF</button></div></div>
    <div id="print-area" className="plan-preview">
      <div className="print-heading"><h1>{plan.name}</h1><p>{patient.name} · {plan.calories} kcal / giorno · aggiornato {formatDate(plan.updatedAt.slice(0, 10))}</p></div>
      {tab === 'week' ? <>
        <div className="screen-week"><div className="day-tabs no-print">{DAY_SHORT.map((label, index) => <button key={label} className={day === index ? 'active' : ''} onClick={() => setDay(index)}>{label}</button>)}</div><PreviewDay title={DAY_NAMES[day]} meals={plan.plan.days[day] ?? []} foods={foods} foodsMap={foodsMap} /></div>
        <div className="print-week" aria-hidden="true">{DAY_NAMES.map((name, index) => <PreviewDay key={name} title={name} meals={plan.plan.days[index] ?? []} foods={foods} foodsMap={foodsMap} />)}</div>
      </> : <div className="shopping-view">
        <div className="shopping-summary no-print"><div><strong>{shoppingRows.length - checked.length} ingredienti da acquistare</strong><span>Quantità aggregate sull’intera settimana</span></div>{checked.length > 0 && <button className="text-button" onClick={() => setChecked([])}>Azzera {checked.length} spunte</button>}</div>
        <div className="shopping-groups">{categories.map(category => <section className="shopping-category" key={category}><h3>{category}</h3><div className="shopping-list">{shoppingRows.filter(row => row.food.category === category).map(({ food, grams }) => <button type="button" aria-pressed={checked.includes(food.id)} className={checked.includes(food.id) ? 'checked' : ''} key={food.id} onClick={() => toggleChecked(food.id)}><span className="shopping-check">{checked.includes(food.id) && <Check size={12} />}</span><div><strong>{food.name}</strong><span>{food.note || food.brand || 'Quantità settimanale'}</span></div><b>{Math.round(grams)} g</b></button>)}</div></section>)}</div>
        {!shoppingRows.length && <EmptyState icon={<ShoppingBag size={27} />} title="Lista vuota" text="Componi almeno un pasto per generare la lista spesa." />}
      </div>}
    </div>
  </Modal>
}

function PreviewDay({ title, meals, foods, foodsMap }: { title: string; meals: PlannedMeal[]; foods: Food[]; foodsMap: Map<string, Food> }) {
  return <section className="preview-day"><h2>{title}</h2><div className="preview-meals">{meals.map(meal => { const totals = mealTotals(meal, foods); return <section key={meal.id}><div><h3>{meal.name}</h3><strong>{Math.round(totals.kcal)} kcal</strong></div>{meal.items.length ? meal.items.map(item => { const food = foodsMap.get(item.foodId); return food ? <p key={item.id}><span>{food.name}{food.note ? ` · ${food.note}` : ''}</span><b>{item.grams} g</b></p> : null }) : <p className="muted-block">Pasto non composto</p>}</section>})}</div></section>
}

function CheckRow({ ok, text }: { ok: boolean; text: string }) {
  return <div className={`check-row ${ok ? 'ok' : ''}`}>{ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}<span>{text}</span></div>
}
