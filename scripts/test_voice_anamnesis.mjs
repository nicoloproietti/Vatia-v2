// Test unitari e contratti browser SIMULATI: non validano microfono, pack o modelli reali.
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [new URL('../src/lib/voiceAnamnesis.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})
const code = bundle.outputFiles[0].text
const voice = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const emptyAnamnesis = () => Object.fromEntries(voice.ANAMNESIS_KEYS.map(key => [key, '']))

beforeEach(() => {
  globalThis.window = {}
})

test('funzione pura: Regole locali estraggono valori ed evidenze testuali', () => {
  const result = voice.localAnamnesisAnalysisDetailed('Allergie: nichel. Alimentazione vegetariana. Pasti fuori casa: 3. Sonno: 7 ore.')
  assert.equal(result.values.allergies, 'nichel')
  assert.equal(result.values.dietType, 'Vegetariana')
  assert.equal(result.values.mealsOut, '3')
  assert.equal(result.values.sleep, '7 ore')
  assert.equal(result.evidence.allergies, 'Allergie: nichel')
  assert.equal(result.evidence.dietType, 'vegetariana')
})

test('funzione pura: testo non strutturato resta una nota verificabile', () => {
  const text = 'Riferisce stanchezza serale da due settimane'
  const result = voice.localAnamnesisAnalysisDetailed(text)
  assert.equal(result.values.clinicalNotes, text)
  assert.equal(result.evidence.clinicalNotes, text)
})

test('funzione pura: collectSpeechResults ignora interim nell’estrazione finale', () => {
  const result = voice.collectSpeechResults({
    resultIndex: 1,
    results: [
      { isFinal: true, 0: { transcript: 'non rielaborare' } },
      { isFinal: true, 0: { transcript: 'Allergie: nichel.' } },
      { isFinal: false, 0: { transcript: 'sonno sette' } },
    ],
  })
  assert.equal(result.final, 'Allergie: nichel.')
  assert.equal(result.interim, 'sonno sette')
})

test('browser simulato: LanguageModel usa il contratto testuale en e distrugge la sessione', async () => {
  let availabilityOptions
  let createOptions
  let destroyed = false
  globalThis.window.LanguageModel = {
    availability: async options => {
      availabilityOptions = options
      return 'available'
    },
    create: async options => {
      createOptions = options
      return {
        prompt: async () => JSON.stringify({
          conditions: { value: 'ipotiroidismo', evidence: 'Patologie: ipotiroidismo' },
          allergies: { value: 'nichel', evidence: 'citazione inventata' },
        }),
        destroy: () => { destroyed = true },
      }
    },
  }
  const result = await voice.analyzeAnamnesis('Patologie: ipotiroidismo. Allergie: nichel.')
  assert.deepEqual(availabilityOptions.expectedInputs, [{ type: 'text', languages: ['en'] }])
  assert.deepEqual(createOptions.expectedInputs, [{ type: 'text', languages: ['en'] }])
  assert.deepEqual(createOptions.expectedOutputs, [{ type: 'text', languages: ['en'] }])
  assert.equal(typeof createOptions.monitor, 'function')
  assert.equal(result.engine, 'AI sul dispositivo')
  assert.equal(result.values.conditions, 'ipotiroidismo')
  assert.equal(result.evidence.conditions, 'Patologie: ipotiroidismo')
  assert.equal(result.evidence.allergies, undefined, 'un’evidenza non presente nel testo deve essere scartata')
  assert.equal(destroyed, true)
})

test('browser simulato: modello non disponibile usa Regole locali senza creare sessioni', async () => {
  let creates = 0
  globalThis.window.LanguageModel = {
    availability: async () => 'unavailable',
    create: async () => { creates += 1; throw new Error('non deve essere chiamata') },
  }
  const result = await voice.analyzeAnamnesis('Sonno: 7 ore.')
  assert.equal(result.engine, 'Regole locali')
  assert.equal(result.values.sleep, '7 ore')
  assert.equal(creates, 0)
  assert.match(result.notice, /Regole locali deterministiche/)
})

test('browser simulato: SpeechRecognition senza processLocally non viene avviato', async () => {
  let starts = 0
  globalThis.window.SpeechRecognition = class {
    start() { starts += 1 }
    stop() {}
  }
  const capability = await voice.inspectSpeechRecognition()
  assert.equal(capability.canStart, false)
  assert.match(capability.message, /non espone la modalità locale/)
  await assert.rejects(() => voice.createLocalSpeechRecognition(), /modalità locale/)
  assert.equal(starts, 0)
})

test('browser simulato: preflight e creazione forzano dettatura italiana locale', async () => {
  let availabilityOptions
  globalThis.window.SpeechRecognition = class {
    constructor() {
      this.processLocally = false
      this.lang = ''
      this.continuous = false
      this.interimResults = false
    }
    static async available(options) {
      availabilityOptions = options
      return 'available'
    }
    start() {}
    stop() {}
  }
  const recognition = await voice.createLocalSpeechRecognition()
  assert.deepEqual(availabilityOptions, { langs: ['it-IT'], processLocally: true })
  assert.equal(recognition.processLocally, true)
  assert.equal(recognition.lang, 'it-IT')
  assert.equal(recognition.continuous, true)
  assert.equal(recognition.interimResults, true)
})

test('browser simulato: installazione italiana richiede processLocally e aggiorna il preflight', async () => {
  let installed = false
  let installOptions
  globalThis.window.SpeechRecognition = class {
    constructor() { this.processLocally = false }
    static async available() { return installed ? 'available' : 'downloadable' }
    static async install(options) {
      installOptions = options
      installed = true
      return true
    }
    start() {}
    stop() {}
  }
  const before = await voice.inspectSpeechRecognition()
  assert.equal(before.canStart, false)
  assert.equal(before.canInstall, true)
  const after = await voice.installItalianSpeechRecognition()
  assert.deepEqual(installOptions, { langs: ['it-IT'], processLocally: true })
  assert.equal(after.canStart, true)
})

test('funzioni pure: revisioni del form in conflitto e soli campi selezionati', () => {
  const base = { ...emptyAnamnesis(), allergies: '', sleep: '6 ore' }
  const current = { ...base, allergies: 'lattice', sleep: '6 ore' }
  assert.deepEqual(voice.getReviewConflicts(base, current), ['allergies'])
  const selected = new Set(['allergies', 'sleep', 'water'])
  const values = voice.buildSelectedValues({ allergies: 'nichel', sleep: '7 ore', water: '   ', conditions: 'non selezionato' }, selected)
  assert.deepEqual(values, { allergies: 'nichel', sleep: '7 ore' })
})

console.log('Nota: questi test usano mock del browser; non sono test reali di dettatura, language pack o qualità del modello.')
