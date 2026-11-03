import type { Anamnesis } from '../types'

export const ANAMNESIS_KEYS = [
  'conditions', 'medications', 'allergies', 'intolerances', 'dietType', 'mealsOut',
  'water', 'alcohol', 'smoking', 'sleep', 'stress', 'supplements', 'clinicalNotes',
] as const satisfies readonly (keyof Anamnesis)[]

export type AnamnesisAnalysis = {
  values: Partial<Anamnesis>
  evidence: Partial<Record<keyof Anamnesis, string>>
  engine: 'AI sul dispositivo' | 'Regole locali'
  notice?: string
}

export type AnalysisOptions = {
  onStatus?: (message: string) => void
}

type LanguageModelSession = {
  prompt: (text: string, options?: { responseConstraint?: object }) => Promise<string>
  destroy: () => void
}
type LanguageModelOptions = {
  expectedInputs: { type: 'text'; languages: string[] }[]
  expectedOutputs: { type: 'text'; languages: string[] }[]
  monitor?: (monitor: { addEventListener: (type: 'downloadprogress', listener: (event: { loaded: number }) => void) => void }) => void
}
type LanguageModelApi = {
  availability: (options?: LanguageModelOptions) => Promise<string>
  create: (options?: LanguageModelOptions) => Promise<LanguageModelSession>
}
export type SpeechResultEvent = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}
export type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  processLocally: boolean
  onresult: ((event: SpeechResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start: () => void
  stop: () => void
}
type LocalSpeechOptions = { langs: string[]; processLocally: true }
type SpeechRecognitionConstructor = {
  new (): SpeechRecognitionInstance
  available?: (options: LocalSpeechOptions) => Promise<string>
  install?: (options: LocalSpeechOptions) => Promise<boolean>
}

export type SpeechCapability = {
  canStart: boolean
  canInstall: boolean
  status: 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown'
  message: string
}
export type ModelCapability = {
  status: 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown'
  message: string
}

declare global {
  interface Window {
    LanguageModel?: LanguageModelApi
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

const LOCAL_SPEECH_OPTIONS: LocalSpeechOptions = { langs: ['it-IT'], processLocally: true }
// La dettatura è it-IT; il contratto testuale della Prompt API usa en anche per transcript italiani.
const LANGUAGE_MODEL_OPTIONS: LanguageModelOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
}
const fieldSchema = {
  type: 'object',
  properties: { value: { type: 'string' }, evidence: { type: 'string' } },
  required: ['value', 'evidence'],
  additionalProperties: false,
}
const schema = {
  type: 'object',
  properties: Object.fromEntries(ANAMNESIS_KEYS.map(key => [key, fieldSchema])),
  required: ANAMNESIS_KEYS,
  additionalProperties: false,
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('it')
}

function normalizeDiet(value: string) {
  return ['Onnivora', 'Vegetariana', 'Vegana', 'Pescetariana'].find(item => item.toLowerCase() === value.toLowerCase()) ?? 'Personalizzata'
}

function cleanDeviceExtraction(value: unknown, transcript: string): Pick<AnamnesisAnalysis, 'values' | 'evidence'> {
  const values: Partial<Anamnesis> = {}
  const evidence: Partial<Record<keyof Anamnesis, string>> = {}
  if (!value || typeof value !== 'object') return { values, evidence }
  const source = value as Record<string, unknown>
  for (const key of ANAMNESIS_KEYS) {
    const candidate = source[key]
    const extracted = typeof candidate === 'string'
      ? { value: candidate, evidence: '' }
      : candidate && typeof candidate === 'object'
        ? candidate as { value?: unknown; evidence?: unknown }
        : {}
    if (typeof extracted.value !== 'string' || !extracted.value.trim()) continue
    values[key] = extracted.value.trim()
    if (typeof extracted.evidence === 'string' && extracted.evidence.trim() && normalized(transcript).includes(normalized(extracted.evidence))) {
      evidence[key] = extracted.evidence.trim()
    }
  }
  if (values.dietType) values.dietType = normalizeDiet(values.dietType)
  return { values, evidence }
}

type Capture = { value: string; evidence: string }
function capture(text: string, labels: string[]): Capture {
  const alternatives = labels.join('|')
  const match = text.match(new RegExp(`(?:^|[\\n.!?;])\\s*(?:${alternatives})\\s*(?:abituale|percepito)?\\s*[:=-]?\\s*([^\\n.!?;]+)`, 'i'))
  if (!match?.[1]) return { value: '', evidence: '' }
  return { value: match[1].trim(), evidence: (match[0] ?? '').replace(/^[\n.!?;]\s*/, '').trim() }
}

export function localAnamnesisAnalysisDetailed(transcript: string): Pick<AnamnesisAnalysis, 'values' | 'evidence'> {
  const text = transcript.trim()
  const found: Partial<Record<keyof Anamnesis, Capture>> = {
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
  if (meals.value) found.mealsOut = { ...meals, value: meals.value.match(/\d+/)?.[0] ?? meals.value }
  const diet = text.match(/\b(onnivora|onnivoro|vegetariana|vegetariano|vegana|vegano|pescetariana|pescetariano)\b/i)
  if (diet?.[1]) {
    const value = diet[1].toLowerCase()
    found.dietType = {
      value: value.startsWith('vegetarian') ? 'Vegetariana' : value.startsWith('vegan') ? 'Vegana' : value.startsWith('pescetarian') ? 'Pescetariana' : 'Onnivora',
      evidence: diet[0],
    }
  }
  const values: Partial<Anamnesis> = {}
  const evidence: Partial<Record<keyof Anamnesis, string>> = {}
  for (const key of ANAMNESIS_KEYS) {
    const item = found[key]
    if (!item?.value) continue
    values[key] = item.value
    if (item.evidence) evidence[key] = item.evidence
  }
  if (!Object.keys(values).length && text) {
    values.clinicalNotes = text
    evidence.clinicalNotes = text
  }
  return { values, evidence }
}

export function localAnamnesisAnalysis(transcript: string): Partial<Anamnesis> {
  return localAnamnesisAnalysisDetailed(transcript).values
}

function rulesAnalysis(transcript: string, notice: string): AnamnesisAnalysis {
  return { ...localAnamnesisAnalysisDetailed(transcript), engine: 'Regole locali', notice }
}

async function deviceAiAnalysis(transcript: string, options: AnalysisOptions): Promise<AnamnesisAnalysis> {
  const model = window.LanguageModel
  if (!model) throw new Error('Modello sul dispositivo non disponibile')
  const availability = await model.availability(LANGUAGE_MODEL_OPTIONS)
  if (availability === 'unavailable') throw new Error('Modello linguistico sul dispositivo non disponibile')
  if (availability === 'downloadable' || availability === 'downloading') {
    options.onStatus?.('Preparazione del modello linguistico sul dispositivo; il download può richiedere tempo.')
  }
  const session = await model.create({
    ...LANGUAGE_MODEL_OPTIONS,
    monitor: monitor => monitor.addEventListener('downloadprogress', event => {
      options.onStatus?.(`Download del modello linguistico: ${Math.round(event.loaded * 100)}%.`)
    }),
  })
  try {
    options.onStatus?.('Estrazione locale dei soli risultati finali…')
    const response = await session.prompt(`Extract nutritional anamnesis data from the Italian transcript below. Do not infer or invent diagnoses, allergies, therapies or habits. Report only explicit facts; write concise values in Italian and use empty strings for absent fields. For each field, evidence must be a contiguous verbatim quote from the transcript supporting value. dietType must be one of Onnivora, Vegetariana, Vegana, Pescetariana, Personalizzata. mealsOut is a number represented as a string. clinicalNotes contains only remaining relevant clinical context.\n\nITALIAN TRANSCRIPT:\n${transcript}`, { responseConstraint: schema })
    return { ...cleanDeviceExtraction(JSON.parse(response), transcript), engine: 'AI sul dispositivo' }
  } finally {
    session.destroy()
  }
}

export async function analyzeAnamnesis(transcript: string, options: AnalysisOptions = {}): Promise<AnamnesisAnalysis> {
  if (!transcript.trim()) throw new Error('Detta o inserisci prima il testo dell’anamnesi.')
  if (window.LanguageModel) {
    try {
      return await deviceAiAnalysis(transcript, options)
    } catch {
      return rulesAnalysis(transcript, 'Il modello locale non è disponibile o non ha completato l’analisi. Sono state usate Regole locali deterministiche: verifica ogni campo e la relativa evidenza.')
    }
  }
  return rulesAnalysis(transcript, 'Questo browser non offre il modello linguistico sul dispositivo. Sono usate solo Regole locali deterministiche, non AI.')
}

function speechConstructor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition
}

export function speechRecognitionAvailable() {
  return Boolean(speechConstructor())
}

export async function inspectSpeechRecognition(): Promise<SpeechCapability> {
  const Constructor = speechConstructor()
  if (!Constructor) return { canStart: false, canInstall: false, status: 'unavailable', message: 'Dettatura non supportata dal browser. Puoi inserire il testo manualmente.' }
  try {
    const probe = new Constructor()
    if (!('processLocally' in probe)) return { canStart: false, canInstall: false, status: 'unavailable', message: 'Il browser offre la dettatura, ma non espone la modalità locale. Per evitare trascrizione cloud non autorizzata, usa il testo manuale.' }
  } catch {
    return { canStart: false, canInstall: false, status: 'unavailable', message: 'Impossibile inizializzare la dettatura locale. Puoi inserire il testo manualmente.' }
  }
  if (!Constructor.available) return { canStart: true, canInstall: false, status: 'unknown', message: 'Modalità locale disponibile; il browser non consente di verificare in anticipo il pacchetto italiano.' }
  try {
    const status = await Constructor.available(LOCAL_SPEECH_OPTIONS)
    if (status === 'available') return { canStart: true, canInstall: false, status, message: 'Dettatura italiana sul dispositivo pronta.' }
    if (status === 'downloadable' || status === 'downloading') return {
      canStart: false,
      canInstall: Boolean(Constructor.install),
      status,
      message: Constructor.install ? 'Il pacchetto italiano locale deve essere installato prima di dettare.' : 'Il pacchetto italiano locale non è pronto; attendi o usa il testo manuale.',
    }
    return { canStart: false, canInstall: false, status: 'unavailable', message: 'Il pacchetto di dettatura italiana locale non è disponibile. Usa il testo manuale.' }
  } catch {
    return { canStart: false, canInstall: false, status: 'unknown', message: 'Non è stato possibile verificare il pacchetto italiano. La dettatura non verrà avviata; usa il testo manuale o riprova.' }
  }
}

export async function installItalianSpeechRecognition(): Promise<SpeechCapability> {
  const Constructor = speechConstructor()
  if (!Constructor?.install) throw new Error('Il browser non consente di installare il pacchetto da qui.')
  const installed = await Constructor.install(LOCAL_SPEECH_OPTIONS)
  if (!installed) throw new Error('Installazione del pacchetto italiano non completata.')
  return inspectSpeechRecognition()
}

export async function createLocalSpeechRecognition(): Promise<SpeechRecognitionInstance> {
  const capability = await inspectSpeechRecognition()
  if (!capability.canStart) throw new Error(capability.message)
  const Constructor = speechConstructor()
  if (!Constructor) throw new Error('Dettatura locale non più disponibile.')
  const instance = new Constructor()
  instance.processLocally = true
  instance.lang = 'it-IT'
  instance.continuous = true
  instance.interimResults = true
  return instance
}

export async function inspectLanguageModel(): Promise<ModelCapability> {
  const model = window.LanguageModel
  if (!model) return { status: 'unavailable', message: 'Modello linguistico locale assente: verranno usate Regole locali.' }
  try {
    const status = await model.availability(LANGUAGE_MODEL_OPTIONS)
    if (status === 'available') return { status, message: 'Modello linguistico sul dispositivo pronto per analizzare il testo italiano.' }
    if (status === 'downloadable' || status === 'downloading') return { status, message: 'Il modello linguistico richiede un download locale prima dell’estrazione AI.' }
    if (status === 'unavailable') return { status, message: 'Modello linguistico non disponibile: verranno usate Regole locali.' }
    return { status: 'unknown', message: 'Disponibilità del modello locale non confermata; se fallisce verranno usate Regole locali.' }
  } catch {
    return { status: 'unknown', message: 'Verifica del modello locale non riuscita; se fallisce verranno usate Regole locali.' }
  }
}

export function collectSpeechResults(event: SpeechResultEvent) {
  let final = ''
  let interim = ''
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index]
    const text = result[0].transcript.trim()
    if (!text) continue
    if (result.isFinal) final += `${text} `
    else interim += `${text} `
  }
  return { final: final.trim(), interim: interim.trim() }
}

export function getReviewConflicts(base: Anamnesis, current: Anamnesis) {
  return ANAMNESIS_KEYS.filter(key => base[key] !== current[key])
}

export function buildSelectedValues(drafts: Partial<Anamnesis>, selected: ReadonlySet<keyof Anamnesis>) {
  const values: Partial<Anamnesis> = {}
  for (const key of ANAMNESIS_KEYS) {
    const value = drafts[key]?.trim()
    if (selected.has(key) && value) values[key] = value
  }
  return values
}
