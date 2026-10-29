import type { ActivityLevel, DietData, DietPlan, Food, MealType, Nutrients, Patient, PlannedMeal, Sex } from '../types'
import { DEFAULT_MEAL_NAMES } from '../types'

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, { value: number; label: string; description: string }> = {
  sedentary: { value: 1.2, label: 'Sedentario', description: 'Poco o nessun esercizio' },
  light: { value: 1.375, label: 'Leggero', description: 'Esercizio 1–3 giorni / settimana' },
  moderate: { value: 1.55, label: 'Moderato', description: 'Esercizio 3–5 giorni / settimana' },
  active: { value: 1.725, label: 'Attivo', description: 'Esercizio 6–7 giorni / settimana' },
  veryActive: { value: 1.9, label: 'Molto attivo', description: 'Esercizio intenso quotidiano' },
}

export const zeroNutrients = (): Nutrients => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })
export const round = (value: number) => Math.round(value * 10) / 10
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const uid = () => crypto.randomUUID()
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const todayKey = () => dateKey(new Date())
export const initials = (name: string) => name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()
export const formatToday = (date: Date) => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
export const formatDate = (value: string, withYear = true) => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(`${value.slice(0, 10)}T12:00:00`))
export const formatDateTime = (value: string) => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
export const dayIndex = (date: Date) => (date.getDay() + 6) % 7

export function calculateBMR(weight: number, height: number, age: number, sex: Sex) {
  const base = 10 * weight + 6.25 * height - 5 * age
  return Math.round(sex === 'male' ? base + 5 : base - 161)
}

export function calculateTDEE(patient: Pick<Patient, 'weight' | 'height' | 'age' | 'sex' | 'activityLevel'>) {
  if (!patient.weight || !patient.height || !patient.age) return 0
  return Math.round(calculateBMR(patient.weight, patient.height, patient.age, patient.sex) * ACTIVITY_MULTIPLIERS[patient.activityLevel].value)
}

export function macroGrams(calories: number, split: { protein: number; carbs: number; fat: number }) {
  return {
    protein: Math.round(calories * split.protein / 100 / 4),
    carbs: Math.round(calories * split.carbs / 100 / 4),
    fat: Math.round(calories * split.fat / 100 / 9),
  }
}

export function defaultSplit(mealCount: number) {
  const presets: Record<number, number[]> = {
    2: [55, 45], 3: [25, 40, 35], 4: [25, 10, 40, 25], 5: [22, 8, 38, 8, 24], 6: [22, 7, 35, 7, 24, 5],
  }
  return presets[mealCount] ?? Array.from({ length: mealCount }, () => Math.round(100 / mealCount))
}

export function createEmptyDiet(_calories: number, mealCount = 4): DietData {
  const kcalPct = defaultSplit(mealCount)
  return {
    macroPercent: { protein: 30, carbs: 40, fat: 30 },
    kcalPct,
    days: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, DEFAULT_MEAL_NAMES[mealCount].map((name, index) => ({ id: uid(), name, items: [], kcalPct: kcalPct[index] }))])),
  }
}

export function normalizeDietData(plan: DietData | undefined, calories: number): DietData {
  if (!plan?.days || !plan.kcalPct?.length) return createEmptyDiet(calories)
  return {
    macroPercent: plan.macroPercent ?? { protein: 30, carbs: 40, fat: 30 },
    kcalPct: plan.kcalPct,
    days: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, (plan.days[day] ?? []).map(meal => ({ ...meal, id: meal.id || uid(), items: (meal.items ?? []).map(item => ({ ...item, id: item.id || uid() })) }))])),
  }
}

export function getMealType(mealName: string): MealType {
  const normalized = mealName.toLowerCase()
  return normalized.includes('colazione') || normalized.includes('spuntino') ? 'light' : 'main'
}

export function foodNutrition(food: Food, grams: number): Nutrients {
  const factor = Math.max(0, grams) / 100
  return {
    kcal: round((food.per100g.kcal ?? 0) * factor),
    protein: round((food.per100g.protein ?? 0) * factor),
    carbs: round((food.per100g.carbs ?? 0) * factor),
    fat: round((food.per100g.fat ?? 0) * factor),
    fiber: round((food.per100g.fiber ?? 0) * factor),
  }
}

export function sumNutrients(items: { food: Food; grams: number }[]) {
  return items.reduce((total, item) => {
    const value = foodNutrition(item.food, item.grams)
    total.kcal += value.kcal
    total.protein += value.protein
    total.carbs += value.carbs
    total.fat += value.fat
    total.fiber = (total.fiber ?? 0) + (value.fiber ?? 0)
    return total
  }, zeroNutrients())
}

export function mealTotals(meal: PlannedMeal, foods: Food[]) {
  const foodMap = new Map(foods.map(food => [food.id, food]))
  return sumNutrients(meal.items.flatMap(item => {
    const food = foodMap.get(item.foodId)
    return food ? [{ food, grams: item.grams }] : []
  }))
}

export function dayTotals(meals: PlannedMeal[], foods: Food[]) {
  return sumNutrients(meals.flatMap(meal => meal.items.flatMap(item => {
    const food = foods.find(candidate => candidate.id === item.foodId)
    return food ? [{ food, grams: item.grams }] : []
  })))
}

export function activePlanFor(plans: DietPlan[], patientId: string) {
  return plans.filter(plan => plan.patientId === patientId).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'Pronta' ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })[0]
}

export function adherenceForDays(days: { kcal: number; target: number; entries: number }[]) {
  const logged = days.filter(day => day.entries > 0)
  if (!logged.length) return 0
  const matching = logged.filter(day => day.target > 0 && Math.abs(day.kcal - day.target) / day.target <= 0.1).length
  return Math.round(matching / logged.length * 100)
}

export function csvDownload(filename: string, rows: (string | number)[][]) {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  const blob = new Blob([`\uFEFF${rows.map(row => row.map(escape).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
