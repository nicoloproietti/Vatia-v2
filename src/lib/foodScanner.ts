import type { Food, Nutrients } from '../types'

export type LabelBasis = '100_g' | '100_ml' | 'portion' | 'unknown'
export type LabelScan = {
  text: string
  basis: LabelBasis
  values: Partial<Nutrients>
  kcalOrigin: 'declared_label' | 'calculated' | null
  warnings: string[]
}

function decimal(value: string) {
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function labelledValue(text: string, labels: RegExp, unit = 'g') {
  const lines = text.split(/\n|;/).map(line => line.trim()).filter(Boolean)
  const line = lines.find(candidate => labels.test(candidate) && !/di cui|of which|satur|zuccheri|sugars/i.test(candidate))
  if (!line) return null
  const afterLabel = line.replace(labels, ' ')
  const match = afterLabel.match(new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*${unit}\\b`, 'i'))
  return match?.[1] ? decimal(match[1]) : null
}

export function parseNutritionLabel(text: string): LabelScan {
  const values: Partial<Nutrients> = {}
  const warnings: string[] = []
  const basis: LabelBasis = /100\s*g\b/i.test(text) ? '100_g' : /100\s*ml\b/i.test(text) ? '100_ml' : /porzion|portion/i.test(text) ? 'portion' : 'unknown'
  const kcal = text.match(/(\d+(?:[.,]\d+)?)\s*kcal\b/i)
  const kj = text.match(/(\d+(?:[.,]\d+)?)\s*kJ\b/i)
  let kcalOrigin: LabelScan['kcalOrigin'] = null
  if (kcal?.[1]) {
    values.kcal = decimal(kcal[1]) ?? undefined
    kcalOrigin = 'declared_label'
  } else if (kj?.[1]) {
    const value = decimal(kj[1])
    if (value != null) {
      values.kcal = Math.round(value / 4.184)
      kcalOrigin = 'calculated'
      warnings.push('Kcal derivate dai kJ letti (÷ 4,184): controlla il valore prima di salvare.')
    }
  }
  values.protein = labelledValue(text, /\bproteine?\b|\bproteins?\b/i) ?? undefined
  values.carbs = labelledValue(text, /\bcarboidrati\b|\bcarbohydrates?\b/i) ?? undefined
  values.fat = labelledValue(text, /^\s*(?:grassi|lipidi|fat)\b/i) ?? undefined
  values.fiber = labelledValue(text, /\bfibre?\b|\bfiber\b/i) ?? undefined
  if (basis === 'unknown') warnings.push('Non ho confermato se i valori siano per 100 g, 100 ml o porzione. Verifica l’intestazione dell’etichetta.')
  if (basis === 'portion') warnings.push('La dicitura “porzione” richiede il peso della porzione: non convertire automaticamente a 100 g.')
  const missing = (['kcal', 'protein', 'carbs', 'fat'] as const).filter(key => values[key] == null)
  if (missing.length) warnings.push(`Valori da completare o confermare manualmente: ${missing.join(', ')}.`)
  return { text, basis, values, kcalOrigin, warnings }
}

export async function readNutritionLabel(image: File, onStatus?: (message: string) => void): Promise<LabelScan> {
  onStatus?.('Avvio del motore OCR sul dispositivo…')
  const { createWorker } = await import('tesseract.js')
  const base = import.meta.env.BASE_URL
  const worker = await createWorker(['ita', 'eng'], 1, {
    workerPath: `${base}ocr/worker.min.js`,
    corePath: `${base}ocr/core/tesseract-core-lstm.wasm.js`,
    langPath: `${base}ocr/lang`,
    workerBlobURL: false,
    cacheMethod: 'write',
    logger: message => {
      if (message.status === 'recognizing text') onStatus?.(`Lettura locale dell’etichetta: ${Math.round((message.progress ?? 0) * 100)}%.`)
    },
  })
  try {
    const result = await worker.recognize(image)
    return parseNutritionLabel(result.data.text)
  } finally {
    await worker.terminate()
  }
}

type VisionSession = {
  prompt: (input: unknown, options?: { responseConstraint?: object }) => Promise<string>
  destroy: () => void
}
type VisionModel = {
  availability: (options: object) => Promise<string>
  create: (options: object) => Promise<VisionSession>
}

const visionOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
}

export async function inspectLocalFoodVision() {
  const model = (window as unknown as { LanguageModel?: VisionModel }).LanguageModel
  if (!model) return { available: false, message: 'Riconoscimento visivo locale non supportato: puoi cercare l’alimento manualmente.' }
  try {
    const status = await model.availability(visionOptions)
    if (status === 'unavailable') return { available: false, message: 'Il modello visivo locale non è disponibile su questo dispositivo.' }
    return { available: true, message: status === 'available' ? 'Il browser dichiara supporto visivo locale; la risposta effettiva viene verificata durante l’analisi.' : 'Il primo utilizzo può richiedere il download del modello locale.' }
  } catch {
    return { available: false, message: 'Non è stato possibile verificare il modello visivo locale.' }
  }
}

function cleanVisionLabel(value: unknown) {
  if (typeof value !== 'string') return null
  const label = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').replace(/^['"]|['"]$/g, '').trim()
  if (!label || label.length > 60 || /[\n\r{}[\]]/.test(label)) return null
  if (/^(?:on-device|unknown|null|none|unclear|error|sorry)\b/i.test(label)) return null
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s'-]*$/u.test(label)) return null
  return label
}

export function parseFoodPhotoResponse(response: string): { label: string | null; uncertain: boolean } {
  let parsed: { label?: unknown; uncertain?: unknown } | null = null
  try {
    parsed = JSON.parse(response) as { label?: unknown; uncertain?: unknown }
  } catch {
    const embedded = response.match(/\{[\s\S]*\}/)?.[0]
    if (embedded) {
      try { parsed = JSON.parse(embedded) as { label?: unknown; uncertain?: unknown } } catch { /* Gestito sotto con un messaggio non tecnico. */ }
    }
  }
  if (parsed && typeof parsed === 'object') {
    const label = cleanVisionLabel(parsed.label)
    if (label || parsed.label === null) return { label, uncertain: parsed.uncertain !== false }
  }
  const plainLabel = cleanVisionLabel(response)
  if (plainLabel) return { label: plainLabel, uncertain: true }
  throw new Error('Il modello visivo non ha restituito un alimento leggibile. Riprova con una foto più nitida oppure cerca l’alimento manualmente.')
}

export async function recognizeFoodPhoto(image: File): Promise<{ label: string | null; uncertain: boolean }> {
  const model = (window as unknown as { LanguageModel?: VisionModel }).LanguageModel
  if (!model) throw new Error('Modello visivo locale non disponibile.')
  const status = await model.availability(visionOptions)
  if (status === 'unavailable') throw new Error('Modello visivo locale non disponibile su questo dispositivo.')
  const session = await model.create(visionOptions)
  try {
    const response = await session.prompt([{ role: 'user', content: [
      { type: 'text', value: 'Identify only the main visible generic food. If unclear or multiple foods are visible, return label=null and uncertain=true. Do not infer brand, ingredients, weight, calories or nutrients.' },
      { type: 'image', value: image },
    ] }], { responseConstraint: {
      type: 'object', additionalProperties: false, required: ['label', 'uncertain'],
      properties: { label: { type: ['string', 'null'] }, uncertain: { type: 'boolean' } },
    } })
    if (/On-device model is not available in Chromium|API is just echoing back the input/i.test(response)) {
      throw new Error('Questo browser non esegue realmente il modello visivo: ha restituito il prompt senza analizzare l’immagine. Usa la ricerca manuale oppure un browser con AI visiva locale effettivamente disponibile.')
    }
    try {
      return parseFoodPhotoResponse(response)
    } catch {
      // Alcuni modelli locali ignorano il vincolo JSON: un solo retry testuale, sempre sul dispositivo.
      const retry = await session.prompt('Based only on the image above, return ONLY the main generic food name in English, or UNKNOWN if unclear. No explanation, JSON, brand, weight or nutrients.')
      return parseFoodPhotoResponse(retry)
    }
  } finally {
    session.destroy()
  }
}

const PHOTO_SYNONYMS: Record<string, string> = {
  chicken: 'pollo', breast: 'petto', beef: 'manzo', pork: 'maiale', turkey: 'tacchino', fish: 'pesce', salmon: 'salmone',
  tuna: 'tonno', rice: 'riso', pasta: 'pasta', bread: 'pane', oats: 'avena', egg: 'uovo', eggs: 'uova', milk: 'latte',
  cheese: 'formaggio', apple: 'mela', banana: 'banana', orange: 'arancia', lemon: 'limone', potato: 'patata', potatoes: 'patate',
  tomato: 'pomodoro', tomatoes: 'pomodori', carrot: 'carota', carrots: 'carote', zucchini: 'zucchina', courgette: 'zucchina',
  almonds: 'mandorle', almond: 'mandorla', walnuts: 'noci', walnut: 'noce', olive: 'oliva', oil: 'olio', yogurt: 'yogurt',
}

function searchTokens(value: string) {
  const normalized = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ')
  return normalized.split(/\s+/).filter(token => token.length > 2).map(token => PHOTO_SYNONYMS[token] ?? token)
}

export function matchFoodCandidates(label: string, foods: Food[], limit = 5) {
  const tokens = searchTokens(label)
  if (!tokens.length) return []
  return foods.filter(food => !food.isLegacy).map(food => {
    const nameTokens = new Set(searchTokens(`${food.name} ${food.originalName ?? ''}`))
    const score = tokens.reduce((sum, token) => sum + (nameTokens.has(token) ? 2 : [...nameTokens].some(candidate => candidate.startsWith(token) || token.startsWith(candidate)) ? 1 : 0), 0)
    return { food, score }
  }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name)).slice(0, limit).map(candidate => candidate.food)
}
