import type { DietPlan, Food, Patient } from '../types'
import { uid } from './clinical'

export const PRACTICE_LEARNING_VERSION = 1
export const MIN_PATTERN_PLANS = 2
export const MIN_FOOD_USES = 3
const MAX_RECENT_PLANS = 40
const MAX_GRAMS = 10000

export type PracticeLearningStats = {
  plans: number
  days: number
  meals: number
}

export type MacroPattern = {
  protein: number
  carbs: number
  fat: number
  samples: number
}

export type MealDistributionPattern = {
  mealCount: number
  kcalPct: number[]
  samples: number
}

export type MealFoodPattern = {
  mealKey: string
  mealName: string
  foodId: string
  uses: number
  planCount: number
  medianGrams: number
  typicalGrams: number
}

export type PracticeModel = {
  version: typeof PRACTICE_LEARNING_VERSION
  ownerKey: string
  stats: PracticeLearningStats
  macro: MacroPattern | null
  mealDistributions: Record<number, MealDistributionPattern>
  mealFoods: Record<string, MealFoodPattern[]>
}

export type PracticeSuggestion = {
  id: string
  title: string
  description: string
  reason: string
  samples: number
} & (
  | { kind: 'macro'; macroPercent: { protein: number; carbs: number; fat: number } }
  | { kind: 'kcal'; mealCount: number; kcalPct: number[] }
  | { kind: 'food'; foodId: string; grams: number; dayIndex: number; mealIndex: number; mealName: string }
)

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isFinitePositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

export function practiceLearningStorageKey(ownerKey: string) {
  return `vatia:practice-learning:v${PRACTICE_LEARNING_VERSION}:${encodeURIComponent(ownerKey || 'default')}`
}

export function normalizeMealName(name: string) {
  return name.trim().toLocaleLowerCase('it-IT').replace(/\s+/g, ' ') || 'pasto'
}

/** Normalizza con il metodo dei resti maggiori: valori interi, non negativi, totale esatto 100. */
export function normalizePercentages(values: number[]): number[] | null {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0) return null
  const scaled = values.map(value => value / total * 100)
  const result = scaled.map(Math.floor)
  let remainder = 100 - result.reduce((sum, value) => sum + value, 0)
  const order = scaled
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let index = 0; index < order.length && remainder > 0; index += 1, remainder -= 1) {
    result[order[index].index] += 1
  }
  return remainder === 0 && result.reduce((sum, value) => sum + value, 0) === 100 ? result : null
}

function emptyModel(ownerKey: string): PracticeModel {
  return {
    version: PRACTICE_LEARNING_VERSION,
    ownerKey,
    stats: { plans: 0, days: 0, meals: 0 },
    macro: null,
    mealDistributions: {},
    mealFoods: {},
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function typicalGrams(value: number) {
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value / 5) * 5
  return Math.min(MAX_GRAMS, Math.max(0.1, rounded))
}

export function buildPracticeModel(ownerKey: string, plans: DietPlan[]): PracticeModel {
  const model = emptyModel(ownerKey)
  const recentPlans = [...plans]
    .filter(plan => isRecord(plan) && isRecord(plan.plan))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    .slice(0, MAX_RECENT_PLANS)
  const macroSamples: number[][] = []
  const distributions = new Map<number, number[][]>()
  const foodsByMeal = new Map<string, Map<string, { mealName: string; grams: number[]; planIds: Set<string> }>>()
  const mealNames = new Map<string, string>()
  model.stats.plans = recentPlans.length

  recentPlans.forEach((plan, planIndex) => {
    const macro = plan.plan.macroPercent
    if (macro) {
      const normalized = normalizePercentages([macro.protein, macro.carbs, macro.fat])
      if (normalized) macroSamples.push(normalized)
    }

    const kcalPct = plan.plan.kcalPct
    if (Array.isArray(kcalPct) && kcalPct.length >= 2 && kcalPct.length <= 6) {
      const normalized = normalizePercentages(kcalPct)
      if (normalized) {
        const samples = distributions.get(kcalPct.length) ?? []
        samples.push(normalized)
        distributions.set(kcalPct.length, samples)
      }
    }

    const days = isRecord(plan.plan.days) ? plan.plan.days : {}
    Object.values(days).forEach(meals => {
      if (!Array.isArray(meals)) return
      let dayHasItems = false
      meals.forEach(meal => {
        if (!isRecord(meal) || !Array.isArray(meal.items)) return
        const items = meal.items.filter(item => isRecord(item) && typeof item.foodId === 'string' && item.foodId && isFinitePositive(item.grams) && item.grams <= MAX_GRAMS)
        if (!items.length) return
        dayHasItems = true
        model.stats.meals += 1
        const mealName = typeof meal.name === 'string' && meal.name.trim() ? meal.name.trim() : 'Pasto'
        const mealKey = normalizeMealName(mealName)
        if (!mealNames.has(mealKey)) mealNames.set(mealKey, mealName)
        const byFood = foodsByMeal.get(mealKey) ?? new Map<string, { mealName: string; grams: number[]; planIds: Set<string> }>()
        items.forEach(item => {
          const bucket = byFood.get(item.foodId) ?? { mealName, grams: [], planIds: new Set<string>() }
          bucket.grams.push(item.grams)
          bucket.planIds.add(plan.id || `plan-${planIndex}`)
          byFood.set(item.foodId, bucket)
        })
        foodsByMeal.set(mealKey, byFood)
      })
      if (dayHasItems) model.stats.days += 1
    })
  })

  if (macroSamples.length >= MIN_PATTERN_PLANS) {
    const averages = [0, 1, 2].map(index => macroSamples.reduce((sum, sample) => sum + sample[index], 0) / macroSamples.length)
    const normalized = normalizePercentages(averages)
    if (normalized) {
      model.macro = { protein: normalized[0], carbs: normalized[1], fat: normalized[2], samples: macroSamples.length }
    }
  }

  distributions.forEach((samples, mealCount) => {
    if (samples.length < MIN_PATTERN_PLANS) return
    const averages = Array.from({ length: mealCount }, (_, index) => samples.reduce((sum, sample) => sum + sample[index], 0) / samples.length)
    const kcalPct = normalizePercentages(averages)
    if (kcalPct) model.mealDistributions[mealCount] = { mealCount, kcalPct, samples: samples.length }
  })

  foodsByMeal.forEach((byFood, mealKey) => {
    model.mealFoods[mealKey] = [...byFood.entries()].map(([foodId, bucket]) => {
      const medianGrams = median(bucket.grams)
      return {
        mealKey,
        mealName: mealNames.get(mealKey) ?? bucket.mealName,
        foodId,
        uses: bucket.grams.length,
        planCount: bucket.planIds.size,
        medianGrams,
        typicalGrams: typicalGrams(medianGrams),
      }
    }).sort((a, b) => b.planCount - a.planCount || b.uses - a.uses || a.foodId.localeCompare(b.foodId))
  })

  return model
}

function validMacro(value: unknown): value is MacroPattern {
  if (!isRecord(value) || !isNonNegativeInteger(value.samples) || value.samples < MIN_PATTERN_PLANS) return false
  const values = [value.protein, value.carbs, value.fat]
  return values.every(isNonNegativeInteger) && values.reduce((sum, value) => sum + value, 0) === 100
}

function validDistribution(value: unknown): value is MealDistributionPattern {
  if (!isRecord(value) || !isNonNegativeInteger(value.samples) || value.samples < MIN_PATTERN_PLANS) return false
  if (!Number.isInteger(value.mealCount) || Number(value.mealCount) < 2 || Number(value.mealCount) > 6 || !Array.isArray(value.kcalPct)) return false
  return value.kcalPct.length === value.mealCount && value.kcalPct.every(isNonNegativeInteger) && value.kcalPct.reduce((sum, value) => sum + value, 0) === 100
}

function validFoodPattern(value: unknown): value is MealFoodPattern {
  if (!isRecord(value)) return false
  return typeof value.mealKey === 'string' && Boolean(value.mealKey) &&
    typeof value.mealName === 'string' && Boolean(value.mealName) &&
    typeof value.foodId === 'string' && Boolean(value.foodId) &&
    isNonNegativeInteger(value.uses) && value.uses > 0 &&
    isNonNegativeInteger(value.planCount) && value.planCount > 0 && value.planCount <= value.uses &&
    isFinitePositive(value.medianGrams) && value.medianGrams <= MAX_GRAMS &&
    isFinitePositive(value.typicalGrams) && value.typicalGrams <= MAX_GRAMS
}

export function validatePracticeModel(value: unknown, ownerKey: string): value is PracticeModel {
  if (!isRecord(value) || value.version !== PRACTICE_LEARNING_VERSION || value.ownerKey !== ownerKey) return false
  if (!isRecord(value.stats) || !isNonNegativeInteger(value.stats.plans) || !isNonNegativeInteger(value.stats.days) || !isNonNegativeInteger(value.stats.meals)) return false
  if (value.macro !== null && !validMacro(value.macro)) return false
  if (!isRecord(value.mealDistributions) || !Object.values(value.mealDistributions).every(validDistribution)) return false
  if (!isRecord(value.mealFoods) || !Object.values(value.mealFoods).every(patterns => Array.isArray(patterns) && patterns.every(validFoodPattern))) return false
  return true
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export function loadPracticeModel(ownerKey: string, storage?: StorageLike): PracticeModel | null {
  try {
    const raw = (storage ?? browserStorage())?.getItem(practiceLearningStorageKey(ownerKey))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return validatePracticeModel(parsed, ownerKey) ? parsed : null
  } catch {
    return null
  }
}

export function persistPracticeModel(model: PracticeModel, storage?: StorageLike) {
  try {
    const target = storage ?? browserStorage()
    if (!target || !validatePracticeModel(model, model.ownerKey)) return false
    target.setItem(practiceLearningStorageKey(model.ownerKey), JSON.stringify(model))
    return true
  } catch {
    return false
  }
}

function sameValues(a: number[], b: number[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function foodTarget(currentPlan: DietPlan, mealKey: string, foodId: string) {
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const meals = currentPlan.plan.days[dayIndex] ?? []
    for (let mealIndex = 0; mealIndex < meals.length; mealIndex += 1) {
      const meal = meals[mealIndex]
      if (normalizeMealName(meal.name) === mealKey && !meal.items.some(item => item.foodId === foodId)) {
        return { dayIndex, mealIndex, mealName: meal.name }
      }
    }
  }
  return null
}

export function buildPracticeSuggestions({ model, currentPlan, foods }: { model: PracticeModel; currentPlan: DietPlan; foods: Food[] }): PracticeSuggestion[] {
  const suggestions: PracticeSuggestion[] = []
  const currentMacro = currentPlan.plan.macroPercent
  if (model.macro && !sameValues([currentMacro.protein, currentMacro.carbs, currentMacro.fat], [model.macro.protein, model.macro.carbs, model.macro.fat])) {
    suggestions.push({
      id: 'macro-abituale',
      kind: 'macro',
      title: 'Distribuzione macro abituale',
      description: `Proteine ${model.macro.protein}% · Carboidrati ${model.macro.carbs}% · Grassi ${model.macro.fat}%`,
      reason: `Media normalizzata di ${model.macro.samples} piani salvati.`,
      samples: model.macro.samples,
      macroPercent: { protein: model.macro.protein, carbs: model.macro.carbs, fat: model.macro.fat },
    })
  }

  const mealCount = currentPlan.plan.kcalPct.length
  const distribution = model.mealDistributions[mealCount]
  if (distribution && !sameValues(currentPlan.plan.kcalPct, distribution.kcalPct)) {
    suggestions.push({
      id: `kcal-${mealCount}`,
      kind: 'kcal',
      title: `Ripartizione abituale su ${mealCount} pasti`,
      description: distribution.kcalPct.map(value => `${value}%`).join(' · '),
      reason: `Pattern da ${distribution.samples} piani salvati con lo stesso numero di pasti.`,
      samples: distribution.samples,
      mealCount,
      kcalPct: [...distribution.kcalPct],
    })
  }

  const foodMap = new Map(foods.filter(food => !food.isLegacy).map(food => [food.id, food]))
  const foodPatterns = Object.values(model.mealFoods).flat()
    .filter(pattern => pattern.planCount >= MIN_PATTERN_PLANS && pattern.uses >= MIN_FOOD_USES && foodMap.has(pattern.foodId))
    .sort((a, b) => b.planCount - a.planCount || b.uses - a.uses || a.mealKey.localeCompare(b.mealKey))
  for (const pattern of foodPatterns) {
    const target = foodTarget(currentPlan, pattern.mealKey, pattern.foodId)
    const food = foodMap.get(pattern.foodId)
    if (!target || !food) continue
    suggestions.push({
      id: `food-${pattern.mealKey}-${pattern.foodId}-${target.dayIndex}-${target.mealIndex}`,
      kind: 'food',
      title: `${food.name} in ${target.mealName}`,
      description: `${pattern.typicalGrams} g · giorno ${target.dayIndex + 1}`,
      reason: `Presente in ${pattern.planCount} piani e ${pattern.uses} pasti; quantità mediana abituale.`,
      samples: pattern.uses,
      foodId: pattern.foodId,
      grams: pattern.typicalGrams,
      ...target,
    })
    if (foodPatterns.indexOf(pattern) >= 2 || suggestions.filter(item => item.kind === 'food').length >= 3) break
  }
  return suggestions
}

/** Aggiornamento immutabile: soltanto il nuovo eventuale item riceve un nuovo ID. */
export function applyPracticeSuggestion(currentPlan: DietPlan, suggestion: PracticeSuggestion): DietPlan | null {
  if (suggestion.kind === 'macro') {
    const values = [suggestion.macroPercent.protein, suggestion.macroPercent.carbs, suggestion.macroPercent.fat]
    if (values.some(value => !Number.isFinite(value) || value < 0) || values.reduce((sum, value) => sum + value, 0) !== 100) return null
    return { ...currentPlan, plan: { ...currentPlan.plan, macroPercent: { ...suggestion.macroPercent } } }
  }
  if (suggestion.kind === 'kcal') {
    if (suggestion.mealCount !== currentPlan.plan.kcalPct.length || suggestion.kcalPct.length !== suggestion.mealCount) return null
    if (suggestion.kcalPct.some(value => !Number.isFinite(value) || value < 0) || suggestion.kcalPct.reduce((sum, value) => sum + value, 0) !== 100) return null
    return { ...currentPlan, plan: { ...currentPlan.plan, kcalPct: [...suggestion.kcalPct] } }
  }

  const meals = currentPlan.plan.days[suggestion.dayIndex]
  const meal = meals?.[suggestion.mealIndex]
  if (!meal || normalizeMealName(meal.name) !== normalizeMealName(suggestion.mealName)) return null
  if (!isFinitePositive(suggestion.grams) || suggestion.grams > MAX_GRAMS || meal.items.some(item => item.foodId === suggestion.foodId)) return null
  const nextMeals = meals.map((candidate, index) => index === suggestion.mealIndex ? {
    ...candidate,
    items: [...candidate.items.map(item => ({ ...item })), { id: uid(), foodId: suggestion.foodId, grams: suggestion.grams }],
  } : candidate)
  return {
    ...currentPlan,
    plan: { ...currentPlan.plan, days: { ...currentPlan.plan.days, [suggestion.dayIndex]: nextMeals } },
  }
}

/** Il testo libero non viene interpretato e non esclude alimenti: richiama soltanto la verifica professionale. */
export function practiceContextNotes(patient: Patient): string[] {
  const anamnesis = patient.anamnesis
  const notes: string[] = []
  if (anamnesis.allergies?.trim() || anamnesis.intolerances?.trim()) {
    notes.push('Allergie o intolleranze presenti: verificale manualmente; il motore non esegue controlli clinici sugli alimenti.')
  }
  if (anamnesis.dietType?.trim()) {
    notes.push(`Regime dichiarato: ${anamnesis.dietType.trim()}. Verifica la compatibilità prima di applicare.`)
  }
  if (anamnesis.clinicalNotes?.trim()) {
    notes.push('Sono presenti note cliniche: restano nel contesto del paziente e non vengono interpretate dal motore.')
  }
  return notes
}
