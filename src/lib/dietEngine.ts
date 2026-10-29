import type { Food, Nutrients, PlanItem } from '../types'
import { foodNutrition, getMealType, uid } from './clinical'

const VERDURE_GRAMS = 200
const isVerdura = (food: Food) => food.category === 'verdure'

export function isFoodSuitable(food: Food, mealName: string) {
  const tag = food.meals ?? 'all'
  const mealType = getMealType(mealName)
  return tag === 'all' || tag === mealType
}

export function gaussJordan(matrix: number[][], values: number[]) {
  const n = matrix.length
  if (!n) return []
  const work = matrix.map((row, index) => [...row, values[index]])
  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let row = col + 1; row < n; row++) if (Math.abs(work[row][col]) > Math.abs(work[pivotRow][col])) pivotRow = row
    ;[work[col], work[pivotRow]] = [work[pivotRow], work[col]]
    const pivot = work[col][col]
    if (Math.abs(pivot) < 1e-12) continue
    for (let k = col; k <= n; k++) work[col][k] /= pivot
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = work[row][col]
      for (let k = col; k <= n; k++) work[row][k] -= factor * work[col][k]
    }
  }
  return Array.from({ length: n }, (_, index) => work[index][n] || 0)
}

/** Motore Vatia: least-squares pesati, minimo 10 g e verdure a 200 g complessivi. */
export function solveOptimalGrams(foods: Food[], kcalTarget: number, macroTarget: Nutrients | null) {
  const nonVeg = foods.filter(food => !isVerdura(food))
  const n = nonVeg.length
  if (!n || kcalTarget <= 0) return foods.map(food => isVerdura(food) ? VERDURE_GRAMS : 10)
  const MIN = 10
  const columns = nonVeg.map(food => [
    (food.per100g.protein * 4 + food.per100g.carbs * 4 + food.per100g.fat * 9) / 100,
    food.per100g.protein / 100,
    food.per100g.carbs / 100,
    food.per100g.fat / 100,
  ])
  const target = macroTarget ? [kcalTarget, macroTarget.protein, macroTarget.carbs, macroTarget.fat] : [kcalTarget, 0, 0, 0]
  const weights = macroTarget ? [2, 5, 1, 3] : [1, 0, 0, 0]
  const buildSystem = (freeIndexes: number[]) => {
    const size = freeIndexes.length
    const gram = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) =>
      weights.reduce((sum, weight, k) => sum + weight * columns[freeIndexes[row]][k] * columns[freeIndexes[col]][k], 0)))
    const fixed = Array.from({ length: n }, (_, index) => index).filter(index => !freeIndexes.includes(index))
    const adjusted = target.map((value, k) => value - fixed.reduce((sum, index) => sum + MIN * columns[index][k], 0))
    const rhs = Array.from({ length: size }, (_, row) => weights.reduce((sum, weight, k) => sum + weight * columns[freeIndexes[row]][k] * adjusted[k], 0))
    return { gram, rhs }
  }
  let free = Array.from({ length: n }, (_, index) => index)
  let grams = Array<number>(n).fill(0)
  for (let attempt = 0; attempt <= n && free.length; attempt++) {
    const { gram, rhs } = buildSystem(free)
    const solution = gaussJordan(gram, rhs)
    free.forEach((foodIndex, row) => { grams[foodIndex] = solution[row] })
    const negative = free.findIndex((_, row) => solution[row] < MIN)
    if (negative === -1) break
    grams[free[negative]] = MIN
    free = free.filter((_, row) => row !== negative)
  }
  grams = grams.map(value => Math.max(MIN, value))
  const groups = new Map<string, number[]>()
  nonVeg.forEach((food, index) => groups.set(food.category, [...(groups.get(food.category) ?? []), index]))
  groups.forEach(indexes => {
    if (indexes.length < 2) return
    const equal = Math.max(MIN, indexes.reduce((sum, index) => sum + grams[index], 0) / indexes.length)
    indexes.forEach(index => { grams[index] = equal })
  })
  const totalKcal = grams.reduce((sum, value, index) => sum + value * columns[index][0], 0)
  if (totalKcal > 0) grams = grams.map(value => Math.max(MIN, value * kcalTarget / totalKcal))
  const rounded = grams.map(value => Math.max(MIN, Math.round(value)))
  const vegCount = foods.filter(isVerdura).length
  const vegEach = vegCount > 1 ? Math.round(VERDURE_GRAMS / vegCount) : VERDURE_GRAMS
  let index = 0
  return foods.map(food => isVerdura(food) ? vegEach : rounded[index++])
}

export function optimizeItems(items: PlanItem[], foods: Food[], kcalTarget: number, macroTarget: Nutrients) {
  const selected = items.flatMap(item => {
    const food = foods.find(candidate => candidate.id === item.foodId)
    return food ? [{ item, food }] : []
  })
  const grams = solveOptimalGrams(selected.map(entry => entry.food), kcalTarget, macroTarget)
  return items.map(item => {
    const index = selected.findIndex(entry => entry.item.id === item.id)
    return index >= 0 ? { ...item, grams: grams[index] } : item
  })
}

function firstFood(foods: Food[], ids: string[], categories: string[], mealName: string) {
  return ids.map(id => foods.find(food => food.id === id)).find(Boolean)
    ?? foods.find(food => categories.includes(food.category) && isFoodSuitable(food, mealName))
}

/** Composizione rapida: crea una base coerente con Vatia, poi lascia il controllo al professionista. */
export function quickMealItems(mealName: string, foods: Food[]): PlanItem[] {
  const type = getMealType(mealName)
  const selected = type === 'main'
    ? [
        firstFood(foods, ['pasta_semola'], ['cereali'], mealName),
        firstFood(foods, ['pollo_petto'], ['carne', 'pesce', 'uova', 'formaggi'], mealName),
        firstFood(foods, ['olio_evo'], ['grassi'], mealName),
        firstFood(foods, ['zucchine'], ['verdure'], mealName),
      ]
    : [
        firstFood(foods, ['avena_fiocchi', 'pane_integrale'], ['cereali'], mealName),
        firstFood(foods, ['skyr', 'albume'], ['formaggi', 'latticini', 'uova'], mealName),
        firstFood(foods, ['mandorle', 'burro_di_arachidi'], ['grassi'], mealName),
      ]
  return selected.filter((food): food is Food => Boolean(food)).map(food => ({ id: uid(), foodId: food.id, grams: isVerdura(food) ? 200 : 100 }))
}

export function equivalentGrams(original: Food, replacement: Food, grams: number) {
  const originalKcal = foodNutrition(original, grams).kcal
  if (!replacement.per100g.kcal) return grams
  return Math.max(5, Math.round(originalKcal / replacement.per100g.kcal * 100))
}

export function mealStructureWarnings(mealName: string, items: PlanItem[], foods: Food[]) {
  if (getMealType(mealName) !== 'main' || !items.length) return []
  const categories = new Set(items.map(item => foods.find(food => food.id === item.foodId)?.category))
  const warnings: string[] = []
  if (!categories.has('cereali') && !categories.has('legumi')) warnings.push('Aggiungi una fonte di carboidrati')
  if (!['carne', 'pesce', 'formaggi', 'uova', 'affettati', 'latticini', 'legumi'].some(category => categories.has(category))) warnings.push('Aggiungi una fonte proteica')
  if (!categories.has('verdure')) warnings.push('Aggiungi verdura')
  return warnings
}
