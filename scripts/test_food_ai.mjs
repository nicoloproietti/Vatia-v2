// Test puri e contratti locali: non validano la qualità OCR o dei modelli reali.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

async function load(entry) {
  const bundle = await build({
    entryPoints: [new URL(`../src/${entry}`, import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    external: ['tesseract.js'],
    define: { 'import.meta.env.BASE_URL': '"/"' },
  })
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
}

const scanner = await load('lib/foodScanner.ts')
const catalog = await load('data/catalog.ts')
const engine = await load('lib/dietEngine.ts')

test('catalogo: soli record completi, ID unici e conteggi riconciliati', () => {
  assert.equal(catalog.CIQUAL_RECORDS.length, catalog.CIQUAL_METADATA.counts.accepted_count)
  assert.equal(new Set(catalog.ciqualFoods.map(food => food.id)).size, catalog.ciqualFoods.length)
  assert.equal(catalog.ciqualFoods.length + catalog.CIQUAL_INCOMPLETE_COUNT, catalog.CIQUAL_RECORDS.length)
  assert.ok(catalog.ciqualFoods.length > 500)
  assert.ok(catalog.ciqualFoods.every(food => catalog.hasCompleteNutrients(food)))
})

test('catalogo: il petto di pollo è una materia prima con kcal pubblicate', () => {
  const chicken = catalog.ciqualFoods.find(food => food.id === 'ciqual-36017')
  assert.ok(chicken)
  assert.match(chicken.name, /Pollo, petto senza pelle, crudo/i)
  assert.equal(chicken.per100g.kcal, 110)
  assert.equal(chicken.sourceRelease, '2025-11-03')
})

test('motore: le grammmature usano le kcal della fonte, non 4/4/9', () => {
  const oil = catalog.ciqualFoods.find(food => food.id === 'ciqual-17130')
  assert.ok(oil)
  const grams = engine.solveOptimalGrams([oil], 450, null)
  assert.deepEqual(grams, [50])
})

test('composizione rapida: usa identificativi CIQUAL reali', () => {
  const lunch = engine.quickMealItems('Pranzo', catalog.ciqualFoods)
  assert.deepEqual(lunch.map(item => item.foodId), ['ciqual-9810', 'ciqual-36017', 'ciqual-17130', 'ciqual-20020'])
})

test('OCR: estrae kcal e macronutrienti per 100 g senza confondere i sottocampi', () => {
  const scan = scanner.parseNutritionLabel('Valori nutrizionali per 100 g\nEnergia 1700 kJ / 406 kcal\nGrassi 14 g\ndi cui acidi grassi saturi 2 g\nCarboidrati 3,5 g\ndi cui zuccheri 1 g\nProteine 25 g\nFibre 0,5 g')
  assert.equal(scan.basis, '100_g')
  assert.equal(scan.values.kcal, 406)
  assert.equal(scan.values.protein, 25)
  assert.equal(scan.values.carbs, 3.5)
  assert.equal(scan.values.fat, 14)
  assert.equal(scan.values.fiber, 0.5)
  assert.equal(scan.kcalOrigin, 'declared_label')
})

test('OCR: deriva le kcal dai kJ soltanto con avviso esplicito', () => {
  const scan = scanner.parseNutritionLabel('Per 100 ml\nEnergia 418,4 kJ\nProteine 0 g\nCarboidrati 0 g\nGrassi 0 g')
  assert.equal(scan.basis, '100_ml')
  assert.equal(scan.values.kcal, 100)
  assert.equal(scan.kcalOrigin, 'calculated')
  assert.ok(scan.warnings.some(warning => warning.includes('4,184')))
})

test('OCR: non trasforma automaticamente valori per porzione in valori per 100 g', () => {
  const scan = scanner.parseNutritionLabel('Per porzione\nEnergia 200 kcal\nProteine 10 g\nCarboidrati 20 g\nGrassi 5 g')
  assert.equal(scan.basis, 'portion')
  assert.ok(scan.warnings.some(warning => warning.includes('non convertire automaticamente')))
})

test('OCR: segnala i nutrienti mancanti invece di inventare zero', () => {
  const scan = scanner.parseNutritionLabel('Energia 100 kcal\nProteine 2 g')
  assert.equal(scan.values.carbs, undefined)
  assert.equal(scan.values.fat, undefined)
  assert.ok(scan.warnings.some(warning => warning.includes('carbs, fat')))
})

test('foto: un suggerimento generico trova il petto di pollo CIQUAL', () => {
  const matches = scanner.matchFoodCandidates('chicken breast', catalog.ciqualFoods)
  assert.equal(matches[0]?.id, 'ciqual-36017')
})

test('foto: etichette incomprensibili e voci legacy non generano candidati', () => {
  assert.deepEqual(scanner.matchFoodCandidates('oggetto sconosciuto', catalog.ciqualFoods), [])
  const legacy = { ...catalog.ciqualFoods[0], id: 'legacy-chicken', name: 'Pollo con mandorle', isLegacy: true }
  assert.ok(!scanner.matchFoodCandidates('pollo', [legacy]).some(food => food.id === 'legacy-chicken'))
})

test('foto: accetta JSON valido, JSON racchiuso in testo e una semplice etichetta', () => {
  assert.deepEqual(scanner.parseFoodPhotoResponse('{"label":"Chicken breast","uncertain":false}'), { label: 'Chicken breast', uncertain: false })
  assert.deepEqual(scanner.parseFoodPhotoResponse('```json\n{"label":"Banana","uncertain":true}\n```'), { label: 'Banana', uncertain: true })
  assert.deepEqual(scanner.parseFoodPhotoResponse('French fries'), { label: 'French fries', uncertain: true })
  assert.deepEqual(scanner.parseFoodPhotoResponse('{"label":null,"uncertain":true}'), { label: null, uncertain: true })
})

test('foto: risposte tecniche non JSON diventano un errore comprensibile', () => {
  assert.throws(() => scanner.parseFoodPhotoResponse('On-device model response is unavailable'), /cerca l’alimento manualmente/)
  assert.throws(() => scanner.parseFoodPhotoResponse('{"label":'), /foto più nitida/)
})

test('foto: il browser simulato esegue un solo retry e chiude sempre la sessione', async () => {
  const replies = ['On-device model response is unavailable', 'French fries']
  let calls = 0
  let destroyed = false
  globalThis.window = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () => replies[calls++],
        destroy: () => { destroyed = true },
      }),
    },
  }
  const result = await scanner.recognizeFoodPhoto(new File(['test'], 'food.jpg', { type: 'image/jpeg' }))
  assert.deepEqual(result, { label: 'French fries', uncertain: true })
  assert.equal(calls, 2)
  assert.equal(destroyed, true)
  delete globalThis.window
})

test('foto: un modello fittizio che ripete il prompt viene rilevato senza retry', async () => {
  let calls = 0
  let destroyed = false
  globalThis.window = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () => { calls += 1; return 'On-device model is not available in Chromium, this API is just echoing back the input' },
        destroy: () => { destroyed = true },
      }),
    },
  }
  await assert.rejects(
    () => scanner.recognizeFoodPhoto(new File(['test'], 'food.jpg', { type: 'image/jpeg' })),
    /non esegue realmente il modello visivo/,
  )
  assert.equal(calls, 1)
  assert.equal(destroyed, true)
  delete globalThis.window
})

console.log('Nota: parser e abbinamenti sono verificati; accuratezza OCR/visione su immagini reali richiede un benchmark separato.')
