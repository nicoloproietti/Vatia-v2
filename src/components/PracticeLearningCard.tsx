import { useEffect, useId, useMemo, useState } from 'react'
import { BrainCircuit, Check, Database, LockKeyhole, Plus, Utensils } from 'lucide-react'
import type { DietPlan, Food, Patient } from '../types'
import {
  applyPracticeSuggestion,
  buildPracticeModel,
  buildPracticeSuggestions,
  persistPracticeModel,
  practiceContextNotes,
  type PracticeSuggestion,
} from '../lib/practiceLearning'
import '../practice-learning.css'

export type PracticeLearningCardProps = {
  ownerKey: string
  plans: DietPlan[]
  currentPlan: DietPlan
  patient: Patient
  foods: Food[]
  onApply: (plan: DietPlan) => void
}

export function PracticeLearningCard({ ownerKey, plans, currentPlan, patient, foods, onApply }: PracticeLearningCardProps) {
  const titleId = useId()
  const contextKey = `${ownerKey}:${currentPlan.id}`
  const [application, setApplication] = useState<{ contextKey: string; suggestionId: string } | null>(null)
  const [feedbackState, setFeedbackState] = useState<{ contextKey: string; message: string } | null>(null)
  const appliedId = application?.contextKey === contextKey ? application.suggestionId : null
  const feedback = feedbackState?.contextKey === contextKey ? feedbackState.message : ''
  const model = useMemo(() => buildPracticeModel(ownerKey, plans), [ownerKey, plans])
  const suggestions = useMemo(() => buildPracticeSuggestions({ model, currentPlan, foods }), [model, currentPlan, foods])
  const contextNotes = useMemo(() => practiceContextNotes(patient), [patient])
  const foodsMap = useMemo(() => new Map(foods.map(food => [food.id, food])), [foods])

  useEffect(() => {
    persistPracticeModel(model)
  }, [model])

  const distributions = Object.values(model.mealDistributions).sort((a, b) => a.mealCount - b.mealCount)
  const frequentFoods = Object.values(model.mealFoods).flat()
    .sort((a, b) => b.planCount - a.planCount || b.uses - a.uses)
    .slice(0, 3)

  function apply(suggestion: PracticeSuggestion) {
    const next = applyPracticeSuggestion(currentPlan, suggestion)
    if (!next) {
      setFeedbackState({ contextKey, message: 'Il contesto è cambiato: suggerimento non applicato. Aggiorna o revisiona il piano.' })
      return
    }
    onApply(next)
    setApplication({ contextKey, suggestionId: suggestion.id })
    setFeedbackState({ contextKey, message: 'Suggerimento applicato alla bozza. Revisiona le modifiche prima di salvare.' })
  }

  return <section className="learning-card" aria-labelledby={titleId}>
    <header className="learning-header">
      <div className="learning-heading-icon"><BrainCircuit size={18} aria-hidden="true" /></div>
      <div className="learning-heading-copy">
        <h2 id={titleId}>Apprendimento dallo studio</h2>
        <p>Pattern dai piani salvati, mai dalla bozza non salvata</p>
      </div>
      <span className="learning-local-badge"><LockKeyhole size={11} aria-hidden="true" />Locale</span>
    </header>

    <div className="learning-stats" aria-label="Dati usati per l’apprendimento">
      <div><strong>{model.stats.plans}</strong><span>piani</span></div>
      <div><strong>{model.stats.days}</strong><span>giorni</span></div>
      <div><strong>{model.stats.meals}</strong><span>pasti</span></div>
    </div>

    <p className="learning-privacy">I dati restano nel browser e sono separati per account. Vengono conservati solo pattern aggregati, senza anamnesi o dati identificabili del paziente; nessun invio a servizi esterni.</p>

    <section className="learning-section" aria-label="Pattern riconosciuti">
      <div className="learning-section-title"><Database size={14} aria-hidden="true" /><h3>Pattern riconosciuti</h3></div>
      {model.macro || distributions.length || frequentFoods.length ? <ul className="learning-pattern-list">
        {model.macro && <li><span>Macro abituali</span><strong>P {model.macro.protein}% · C {model.macro.carbs}% · G {model.macro.fat}%</strong><small>{model.macro.samples} piani</small></li>}
        {distributions.slice(0, 2).map(pattern => <li key={pattern.mealCount}><span>{pattern.mealCount} pasti</span><strong>{pattern.kcalPct.map(value => `${value}%`).join(' · ')}</strong><small>{pattern.samples} piani</small></li>)}
        {frequentFoods.map(pattern => <li key={`${pattern.mealKey}-${pattern.foodId}`}><span>{pattern.mealName}</span><strong>{foodsMap.get(pattern.foodId)?.name ?? 'Alimento non più nel database'} · {pattern.typicalGrams} g</strong><small>{pattern.uses} utilizzi</small></li>)}
      </ul> : <p className="learning-empty">Salva altri piani per far emergere distribuzioni e abitudini ricorrenti.</p>}
    </section>

    <section className="learning-section" aria-label="Suggerimenti revisionabili">
      <div className="learning-section-title"><Utensils size={14} aria-hidden="true" /><h3>Suggerimenti per questa bozza</h3></div>
      {suggestions.length ? <div className="learning-suggestions">
        {suggestions.map(suggestion => <article className="learning-suggestion" key={suggestion.id}>
          <div className="learning-suggestion-copy">
            <h4>{suggestion.title}</h4>
            <p>{suggestion.description}</p>
            <small>{suggestion.reason}</small>
          </div>
          <button type="button" className="learning-apply" disabled={appliedId === suggestion.id} onClick={() => apply(suggestion)} aria-label={`Applica: ${suggestion.title}`}>
            {appliedId === suggestion.id ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            {appliedId === suggestion.id ? 'Applicato' : 'Applica'}
          </button>
        </article>)}
      </div> : <p className="learning-empty">Nessuna azione affidabile con i dati attuali. Servono almeno 2 piani per le distribuzioni e 3 utilizzi in 2 piani per gli alimenti.</p>}
    </section>

    {contextNotes.length > 0 && <details className="learning-context">
      <summary>Contesto del paziente da verificare</summary>
      <ul>{contextNotes.map(note => <li key={note}>{note}</li>)}</ul>
    </details>}

    <p className="learning-disclaimer">Suggerimenti statistici, non controlli di sicurezza né indicazioni cliniche. Verifica sempre allergie, intolleranze, preferenze e appropriatezza: non sostituiscono il giudizio professionale.</p>
    <div className="learning-feedback" role="status" aria-live="polite">{feedback}</div>
  </section>
}

export default PracticeLearningCard
