import type { Anamnesis } from '../types'

export type AnamnesisAnalysis = {
  values: Partial<Anamnesis>
  engine: 'AI sul dispositivo' | 'Analisi guidata locale'
  notice?: string
}

type LanguageModelSession = {
  prompt: (text: string, options?: { responseConstraint?: object }) => Promise<string>
  destroy: () => void
}
type LanguageModelApi = {
  availability: () => Promise<string>
  create: () => Promise<LanguageModelSession>
}
export type SpeechResultEvent = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}
export type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

declare global {
  interface Window {
    LanguageModel?: LanguageModelApi
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

const schema = {
  type: 'object',
  properties: {
    conditions: { type: 'string' }, medications: { type: 'string' }, allergies: { type: 'string' },
    intolerances: { type: 'string' }, dietType: { type: 'string' }, mealsOut: { type: 'string' },
    water: { type: 'string' }, alcohol: { type: 'string' }, smoking: { type: 'string' },
    sleep: { type: 'string' }, stress: { type: 'string' }, supplements: { type: 'string' }, clinicalNotes: { type: 'string' },
  },
  required: ['conditions', 'medications', 'allergies', 'intolerances', 'dietType', 'mealsOut', 'water', 'alcohol', 'smoking', 'sleep', 'stress', 'supplements', 'clinicalNotes'],
  additionalProperties: false,
}

function cleanExtraction(value: unknown): Partial<Anamnesis> {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  const output: Partial<Anamnesis> = {}
  for (const key of Object.keys(schema.properties) as (keyof Anamnesis)[]) {
    if (typeof source[key] === 'string' && source[key].trim()) output[key] = source[key].trim()
  }
  if (output.dietType) {
    const match = ['Onnivora', 'Vegetariana', 'Vegana', 'Pescetariana'].find(item => item.toLowerCase() === output.dietType?.toLowerCase())
    output.dietType = match ?? 'Personalizzata'
  }
  return output
}

function capture(text: string, labels: string[]) {
  const alternatives = labels.join('|')
  const match = text.match(new RegExp(`(?:^|[\\n.!?;])\\s*(?:${alternatives})\\s*(?:abituale|percepito)?\\s*[:=-]?\\s*([^\\n.!?;]+)`, 'i'))
  return match?.[1]?.trim() ?? ''
}

export function localAnamnesisAnalysis(transcript: string): Partial<Anamnesis> {
  const text = transcript.trim()
  const values: Partial<Anamnesis> = {
    conditions: capture(text, ['patologie(?: e diagnosi)?', 'diagnosi']),
    medications: capture(text, ['farmaci', 'terapia farmacologica']),
    allergies: capture(text, ['allergie', 'allergia']),
    intolerances: capture(text, ['intolleranze', 'intolleranza']),
    water: capture(text, ['acqua', 'idratazione']),
    alcohol: capture(text, ['alcol', 'alcolici']),
    smoking: capture(text, ['fumo', 'sigarette']),
    sleep: capture(text, ['sonno', 'dorme']),
    stress: capture(text, ['stress']),
    supplements: capture(text, ['integratori', 'integrazione']),
    clinicalNotes: capture(text, ['note cliniche', 'note', 'preferenze']),
  }
  const meals = capture(text, ['pasti fuori casa(?: / settimana)?', 'pasti fuori'])
  if (meals) values.mealsOut = meals.match(/\d+/)?.[0] ?? meals
  const diet = text.match(/\b(onnivora|onnivoro|vegetariana|vegetariano|vegana|vegano|pescetariana|pescetariano)\b/i)?.[1].toLowerCase()
  if (diet) values.dietType = diet.startsWith('vegetarian') ? 'Vegetariana' : diet.startsWith('vegan') ? 'Vegana' : diet.startsWith('pescetarian') ? 'Pescetariana' : 'Onnivora'
  for (const key of Object.keys(values) as (keyof Anamnesis)[]) if (!values[key]) delete values[key]
  if (!Object.keys(values).length && text) values.clinicalNotes = text
  return values
}

async function deviceAiAnalysis(transcript: string): Promise<Partial<Anamnesis>> {
  const model = window.LanguageModel
  if (!model) throw new Error('Modello sul dispositivo non disponibile')
  const availability = await model.availability()
  if (availability === 'unavailable') throw new Error('Modello sul dispositivo non disponibile')
  const session = await model.create()
  try {
    const response = await session.prompt(`Extract nutrition anamnesis facts from the Italian transcript below. Do not infer or invent diagnoses, allergies, therapies or habits. Return only facts explicitly stated. Use empty strings for absent fields. Keep values concise in Italian. dietType must be one of Onnivora, Vegetariana, Vegana, Pescetariana, Personalizzata. mealsOut is a number represented as a string. clinicalNotes contains only remaining clinically relevant context.\n\nTRANSCRIPT:\n${transcript}`, { responseConstraint: schema })
    return cleanExtraction(JSON.parse(response))
  } finally { session.destroy() }
}

export async function analyzeAnamnesis(transcript: string): Promise<AnamnesisAnalysis> {
  if (!transcript.trim()) throw new Error('Detta o inserisci prima il testo dell’anamnesi.')
  if (window.LanguageModel) {
    try {
      return { values: await deviceAiAnalysis(transcript), engine: 'AI sul dispositivo' }
    } catch {
      return { values: localAnamnesisAnalysis(transcript), engine: 'Analisi guidata locale', notice: 'Il modello AI del browser non è disponibile o non ha completato l’analisi. Ho applicato regole locali: verifica con attenzione ogni campo.' }
    }
  }
  return { values: localAnamnesisAnalysis(transcript), engine: 'Analisi guidata locale', notice: 'Questo browser non offre il modello AI sul dispositivo. L’estrazione usa regole locali e richiede la tua verifica.' }
}

export function speechRecognitionAvailable() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}
