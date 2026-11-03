import rawFoods from './ciqual-foods.json'
import rawMetadata from './ciqual-metadata.json'
import type { Food, Nutrients } from '../types'

export type CiqualFoodRecord = {
  id: string
  name: string
  category: string
  source: string
  source_food_id: string
  source_release: string
  licence: string
  edible_basis: string
  processing_state: 'raw' | 'cooked' | 'dried' | 'canned' | 'cured' | 'smoked' | 'unspecified'
  original_name: string
  raw_name: string
  translation_status: string
  translation_review_required: boolean
  per100g: Record<keyof Nutrients, number | null>
  is_public: boolean
}

export const CIQUAL_METADATA = rawMetadata
export const CIQUAL_RECORDS = rawFoods as CiqualFoodRecord[]

export const PROCESSING_LABELS: Record<string, string> = {
  raw: 'Crudo', cooked: 'Cotto', dried: 'Essiccato', canned: 'In conserva',
  cured: 'Stagionato', smoked: 'Affumicato', unspecified: 'Stato non specificato',
}

export function hasCompleteNutrients(food: Pick<Food, 'per100g'>) {
  return (['kcal', 'protein', 'carbs', 'fat'] as const).every(key => {
    const value = food.per100g[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
  })
}

export function toCatalogFood(record: CiqualFoodRecord): Food {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    note: PROCESSING_LABELS[record.processing_state] ?? PROCESSING_LABELS.unspecified,
    meals: 'all',
    per100g: {
      kcal: record.per100g.kcal ?? 0,
      protein: record.per100g.protein ?? 0,
      carbs: record.per100g.carbs ?? 0,
      fat: record.per100g.fat ?? 0,
      ...(typeof record.per100g.fiber === 'number' ? { fiber: record.per100g.fiber } : {}),
    },
    source: record.source,
    sourceFoodId: record.source_food_id,
    sourceRelease: record.source_release,
    licence: record.licence,
    edibleBasis: record.edible_basis,
    processingState: record.processing_state,
    originalName: record.original_name,
    isPublic: true,
  }
}

// I record incompleti restano negli artefatti di import, ma non entrano nel motore clinico.
export const ciqualFoods: Food[] = CIQUAL_RECORDS.filter(record => hasCompleteNutrients({ per100g: record.per100g as Nutrients })).map(toCatalogFood)
export const CIQUAL_INCOMPLETE_COUNT = CIQUAL_RECORDS.length - ciqualFoods.length
