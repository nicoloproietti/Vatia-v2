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
  })
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
}

const engine = await load('lib/practiceLearning.ts')

const foods = [
  { id: 'chicken', name: 'Pollo', category: 'carne', per100g: { kcal: 110, protein: 23, carbs: 0, fat: 2 } },
  { id: 'rice', name: 'Riso', category: 'cereali', per100g: { kcal: 360, protein: 7, carbs: 79, fat: 1 } },
]

function mealsWithChicken(grams = 150, prefix = 'item') {
  return [
    { id: `${prefix}-breakfast`, name: 'Colazione', items: [] },
    { id: `${prefix}-lunch`, name: 'Pranzo', items: [{ id: `${prefix}-chicken`, foodId: 'chicken', grams }] },
    { id: `${prefix}-dinner`, name: 'Cena', items: [] },
  ]
}

function makePlan({ id, updatedAt, macro = [30, 40, 30], kcalPct = [25, 40, 35], days } = {}) {
  return {
    id: id ?? 'plan-1',
    patientId: 'patient-not-persisted',
    name: 'Piano non persistito nel modello',
    status: 'Pronta',
    calories: 2000,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: updatedAt ?? '2026-01-01T08:00:00.000Z',
    plan: {
      macroPercent: { protein: macro[0], carbs: macro[1], fat: macro[2] },
      kcalPct,
      days: days ?? { 0: mealsWithChicken(150, `${id ?? 'plan-1'}-day-0`) },
    },
  }
}

function makeCurrentPlan() {
  return makePlan({
    id: 'draft',
    macro: [20, 50, 30],
    kcalPct: [30, 30, 40],
    days: {
      0: [
        { id: 'draft-breakfast', name: 'Colazione', items: [] },
        { id: 'draft-lunch', name: 'Pranzo', items: [{ id: 'draft-rice', foodId: 'rice', grams: 80 }] },
        { id: 'draft-dinner', name: 'Cena', items: [] },
      ],
    },
  })
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
  }
}

test('normalizzazione: valori validi, finiti e totale esatto 100', () => {
  for (const values of [[1, 1, 1], [33.33, 33.33, 33.34], [0, 2, 3], [12.5, 0, 87.5]]) {
    const normalized = engine.normalizePercentages(values)
    assert.ok(normalized)
    assert.equal(normalized.reduce((sum, value) => sum + value, 0), 100)
    assert.ok(normalized.every(value => Number.isInteger(value) && value >= 0))
  }
  assert.equal(engine.normalizePercentages([Number.NaN, 50, 50]), null)
  assert.equal(engine.normalizePercentages([Infinity, 0]), null)
  assert.equal(engine.normalizePercentages([-1, 50, 51]), null)
  assert.equal(engine.normalizePercentages([0, 0, 0]), null)
})

test('apprendimento: un nuovo piano salvato aggiorna pattern e statistiche', () => {
  const first = makePlan({ id: 'p1', updatedAt: '2026-01-01T08:00:00.000Z', macro: [30, 40, 30] })
  const second = makePlan({ id: 'p2', updatedAt: '2026-01-02T08:00:00.000Z', macro: [50, 20, 30] })
  const initial = engine.buildPracticeModel('studio-a', [first, second])
  assert.deepEqual(initial.macro, { protein: 40, carbs: 30, fat: 30, samples: 2 })
  assert.equal(initial.stats.plans, 2)
  assert.equal(initial.stats.days, 2)
  assert.equal(initial.stats.meals, 2)

  const third = makePlan({ id: 'p3', updatedAt: '2026-01-03T08:00:00.000Z', macro: [40, 40, 20] })
  const evolved = engine.buildPracticeModel('studio-a', [first, second, third])
  assert.deepEqual(evolved.macro, { protein: 40, carbs: 33, fat: 27, samples: 3 })
  assert.equal(evolved.stats.plans, 3)
  assert.notDeepEqual(initial.macro, evolved.macro)
})

test('campioni insufficienti: nessuna distribuzione o alimento viene proposto', () => {
  const saved = makePlan({ id: 'single' })
  const model = engine.buildPracticeModel('studio-a', [saved])
  assert.equal(model.macro, null)
  assert.deepEqual(model.mealDistributions, {})
  assert.equal(model.mealFoods.pranzo[0].uses, 1)
  const suggestions = engine.buildPracticeSuggestions({ model, currentPlan: makeCurrentPlan(), foods })
  assert.deepEqual(suggestions, [])
})

test('suggerimenti sufficienti: macro, kcal e alimento hanno spiegazioni e totali validi', () => {
  const first = makePlan({
    id: 'p1', macro: [1, 1, 1], kcalPct: [1, 1, 1],
    days: { 0: mealsWithChicken(140, 'p1-d0'), 1: mealsWithChicken(160, 'p1-d1') },
  })
  const second = makePlan({ id: 'p2', macro: [2, 1, 1], kcalPct: [2, 1, 1], days: { 0: mealsWithChicken(180, 'p2-d0') } })
  const model = engine.buildPracticeModel('studio-a', [first, second])
  const suggestions = engine.buildPracticeSuggestions({ model, currentPlan: makeCurrentPlan(), foods })
  assert.ok(suggestions.some(item => item.kind === 'macro'))
  assert.ok(suggestions.some(item => item.kind === 'kcal'))
  assert.ok(suggestions.some(item => item.kind === 'food'))
  for (const suggestion of suggestions) {
    assert.ok(suggestion.reason.length > 10)
    if (suggestion.kind === 'macro') assert.equal(Object.values(suggestion.macroPercent).reduce((sum, value) => sum + value, 0), 100)
    if (suggestion.kind === 'kcal') assert.equal(suggestion.kcalPct.reduce((sum, value) => sum + value, 0), 100)
    if (suggestion.kind === 'food') assert.equal(suggestion.grams, 160)
  }
})

test('anamnesi: nessuna esclusione testuale fragile e avviso di verifica esplicito', () => {
  const plans = [
    makePlan({ id: 'p1', days: { 0: mealsWithChicken(150, 'p1-d0'), 1: mealsWithChicken(150, 'p1-d1') } }),
    makePlan({ id: 'p2' }),
  ]
  const model = engine.buildPracticeModel('studio-a', plans)
  const suggestions = engine.buildPracticeSuggestions({ model, currentPlan: makeCurrentPlan(), foods })
  assert.ok(suggestions.some(item => item.kind === 'food' && item.foodId === 'chicken'))
  const patient = {
    anamnesis: { allergies: 'Pollo', intolerances: '', dietType: 'Onnivora', clinicalNotes: 'Nota libera' },
  }
  const notes = engine.practiceContextNotes(patient)
  assert.ok(notes.some(note => note.includes('non esegue controlli clinici')))
  assert.ok(notes.some(note => note.includes('non vengono interpretate')))
})

test('storage: owner isolati, soli aggregati e dati corrotti ignorati', () => {
  const storage = memoryStorage()
  const modelA = engine.buildPracticeModel('studio-a', [makePlan({ id: 'a1' }), makePlan({ id: 'a2' })])
  const modelB = engine.buildPracticeModel('studio-b', [makePlan({ id: 'b1' })])
  assert.equal(engine.persistPracticeModel(modelA, storage), true)
  assert.equal(engine.persistPracticeModel(modelB, storage), true)
  assert.equal(engine.loadPracticeModel('studio-a', storage).stats.plans, 2)
  assert.equal(engine.loadPracticeModel('studio-b', storage).stats.plans, 1)
  assert.equal(engine.loadPracticeModel('studio-c', storage), null)
  assert.ok(!JSON.stringify(modelA).includes('patientId'))
  assert.ok(!JSON.stringify(modelA).includes('Piano non persistito'))

  storage.setItem(engine.practiceLearningStorageKey('studio-a'), '{json-corrotto')
  assert.equal(engine.loadPracticeModel('studio-a', storage), null)
  assert.equal(engine.loadPracticeModel('studio-b', storage).stats.plans, 1)

  const tampered = JSON.parse(JSON.stringify(modelB))
  tampered.stats.plans = -4
  storage.setItem(engine.practiceLearningStorageKey('studio-b'), JSON.stringify(tampered))
  assert.equal(engine.loadPracticeModel('studio-b', storage), null)
})

test('immutabilità: applicazione manuale con nuovo ID solo per il nuovo item', () => {
  const plans = [
    makePlan({ id: 'p1', days: { 0: mealsWithChicken(150, 'p1-d0'), 1: mealsWithChicken(150, 'p1-d1') } }),
    makePlan({ id: 'p2' }),
  ]
  const model = engine.buildPracticeModel('studio-a', plans)
  const current = makeCurrentPlan()
  const snapshot = structuredClone(current)
  const suggestions = engine.buildPracticeSuggestions({ model, currentPlan: current, foods })

  const macro = suggestions.find(item => item.kind === 'macro')
  const withMacro = engine.applyPracticeSuggestion(current, macro)
  assert.notEqual(withMacro, current)
  assert.notEqual(withMacro.plan, current.plan)
  assert.deepEqual(current, snapshot)

  const kcal = suggestions.find(item => item.kind === 'kcal')
  const withKcal = engine.applyPracticeSuggestion(current, kcal)
  assert.notEqual(withKcal.plan.kcalPct, current.plan.kcalPct)
  assert.equal(withKcal.plan.kcalPct.reduce((sum, value) => sum + value, 0), 100)
  assert.deepEqual(current, snapshot)

  const food = suggestions.find(item => item.kind === 'food')
  const withFood = engine.applyPracticeSuggestion(current, food)
  const originalMeal = current.plan.days[0][1]
  const nextMeal = withFood.plan.days[0][1]
  assert.equal(nextMeal.items.length, originalMeal.items.length + 1)
  assert.equal(nextMeal.items[0].id, 'draft-rice')
  assert.notEqual(nextMeal.items[1].id, 'draft-rice')
  assert.ok(nextMeal.items[1].id.length > 10)
  assert.deepEqual(current, snapshot)
  assert.notEqual(withFood.plan.days[0], current.plan.days[0])
})

test('nessuna applicazione automatica: costruire modello e suggerimenti non modifica nulla', () => {
  const plans = [makePlan({ id: 'p1' }), makePlan({ id: 'p2' })]
  const current = makeCurrentPlan()
  const plansSnapshot = structuredClone(plans)
  const currentSnapshot = structuredClone(current)
  const model = engine.buildPracticeModel('studio-a', plans)
  const suggestions = engine.buildPracticeSuggestions({ model, currentPlan: current, foods })
  assert.ok(suggestions.length > 0)
  assert.deepEqual(plans, plansSnapshot)
  assert.deepEqual(current, currentSnapshot)
})

test('valori non finiti o azioni non più valide non producono modifiche rischiose', () => {
  const invalid = makePlan({ id: 'bad', macro: [Number.NaN, 40, 30], kcalPct: [Infinity, 0] })
  const valid = makePlan({ id: 'good' })
  const model = engine.buildPracticeModel('studio-a', [invalid, valid])
  assert.equal(model.macro, null)
  assert.deepEqual(model.mealDistributions, {})
  assert.equal(engine.applyPracticeSuggestion(makeCurrentPlan(), { kind: 'kcal', id: 'bad', title: '', description: '', reason: '', samples: 2, mealCount: 3, kcalPct: [50, 50, 50] }), null)
  const food = { kind: 'food', id: 'bad-food', title: '', description: '', reason: '', samples: 3, foodId: 'chicken', grams: Number.NaN, dayIndex: 0, mealIndex: 1, mealName: 'Pranzo' }
  assert.equal(engine.applyPracticeSuggestion(makeCurrentPlan(), food), null)
})

console.log('Motore di apprendimento verificato: test locali, nessuna valutazione di accuratezza clinica.')
