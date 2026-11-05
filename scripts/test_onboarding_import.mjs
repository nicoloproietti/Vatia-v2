import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

async function load(entry) {
  const bundle = await build({ entryPoints: [new URL(`../src/${entry}`, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
}

const importer = await load('lib/patientImport.ts')
const onboarding = await load('lib/onboarding.ts')

const emptySettings = { studioName: '', professionalName: '', vatNumber: '', taxCode: '', address: '', city: '', postalCode: '', province: '', enpabNumber: '', email: '', phone: '' }
const readySettings = { ...emptySettings, studioName: 'Studio', professionalName: 'Professionista', taxCode: 'CF', address: 'Via 1', city: 'Roma', postalCode: '00100', province: 'RM' }
const baseState = { cloud: false, billingSettings: emptySettings, officeCount: 0, serviceCount: 0, calendarConnected: false, patientCount: 0, dietCount: 0, inviteCount: 0 }

function memoryStorage() {
  const values = new Map()
  return { getItem(key) { return values.get(key) ?? null }, setItem(key, value) { values.set(key, String(value)) } }
}

test('CSV italiano: delimitatore, alias, decimali e target calcolato', () => {
  const parsed = importer.parsePatientCsv('Nome;Email;Età;Sesso;Altezza;Peso;Obiettivo;Attività\nAnna Test;anna@test.example;35;Donna;168;65,5;Mantenimento;Moderato')
  assert.equal(parsed.rows.length, 1)
  assert.equal(parsed.validRows.length, 1)
  assert.equal(parsed.validRows[0].input.weight, 65.5)
  assert.equal(parsed.validRows[0].input.sex, 'female')
  assert.equal(parsed.validRows[0].input.activityLevel, 'moderate')
  assert.ok(parsed.validRows[0].input.calories > 1000)
  assert.equal(parsed.validRows[0].rowNumber, 2)
})

test('CSV inglese: intestazioni e delimitatore riconosciuti automaticamente', () => {
  const parsed = importer.parsePatientCsv('name,email,age,sex,height,weight,goal,activity\nJohn Test,john@test.example,42,male,180,80.5,Performance,active')
  assert.equal(parsed.validRows.length, 1)
  assert.equal(parsed.validRows[0].input.name, 'John Test')
  assert.equal(parsed.validRows[0].input.weight, 80.5)
  assert.equal(parsed.validRows[0].input.activityLevel, 'active')
})

test('validazione: nessun valore clinico non finito o fuori limite viene accettato', () => {
  const parsed = importer.parsePatientCsv('Nome;Email;Età;Sesso;Altezza;Peso\nA;email-errata;9;Altro;99;301\nMario Test;mario@test.example;NaN;Uomo;Infinity;-2')
  assert.equal(parsed.validRows.length, 0)
  assert.equal(parsed.invalidCount, 2)
  assert.ok(parsed.rows[0].errors.some(error => error.includes('Nome')))
  assert.ok(parsed.rows[0].errors.some(error => error.includes('Email')))
  assert.ok(parsed.rows[0].errors.some(error => error.includes('Sesso')))
  assert.ok(parsed.rows[1].errors.some(error => error.includes('Età')))
  assert.ok(parsed.rows[1].errors.some(error => error.includes('Altezza')))
  assert.ok(parsed.rows[1].errors.some(error => error.includes('Peso')))
  assert.ok(parsed.rows.every(row => Number.isFinite(row.input.calories)))
})

test('duplicati: email e nome, nello studio e nel file, sono esclusi', () => {
  const csv = 'Nome;Email\nAnna Esistente;nuova@test.example\nNuovo Nome;esistente@test.example\nMario Nuovo;mario@test.example\nMario Nuovo;mario2@test.example\nAltro Nome;mario@test.example\nPaolo Valido;paolo@test.example'
  const parsed = importer.parsePatientCsv(csv, [{ name: 'Anna Esistente', email: 'esistente@test.example' }])
  assert.equal(parsed.validRows.length, 2)
  assert.deepEqual(parsed.validRows.map(row => row.input.name), ['Mario Nuovo', 'Paolo Valido'])
  assert.equal(parsed.duplicateCount, 4)
})

test('campi opzionali: sesso mancante è esplicitato e non produce target presunto', () => {
  const parsed = importer.parsePatientCsv('Nome;Email;Età;Altezza;Peso\nSenza Sesso;sesso@test.example;35;168;65')
  assert.equal(parsed.validRows.length, 1)
  assert.equal(parsed.validRows[0].input.calories, 0)
  assert.ok(parsed.validRows[0].notes[0].includes('valore provvisorio'))
})

test('file non validi: intestazione nome obbligatoria e righe vuote rifiutate', () => {
  assert.throws(() => importer.parsePatientCsv('Email;Telefono\na@test.example;123'), /Manca la colonna Nome/)
  assert.throws(() => importer.parsePatientCsv('Nome;Email\n'), /non contiene righe/)
})

test('checklist ospite: solo passaggi locali e avanzamento coerente', () => {
  const initial = onboarding.buildOnboardingChecklist(baseState)
  assert.equal(initial.length, 5)
  assert.ok(!initial.some(step => step.id === 'calendar' || step.id === 'invite'))
  assert.equal(initial.filter(step => step.done).length, 0)
  const advanced = onboarding.buildOnboardingChecklist({ ...baseState, billingSettings: readySettings, officeCount: 1, serviceCount: 2, patientCount: 3, dietCount: 1 })
  assert.equal(advanced.length, 5)
  assert.ok(advanced.every(step => step.done))
})

test('checklist cloud: Google e inviti entrano nel completamento', () => {
  const partial = onboarding.buildOnboardingChecklist({ ...baseState, cloud: true, billingSettings: readySettings, officeCount: 1, serviceCount: 1, patientCount: 1, dietCount: 1 })
  assert.equal(partial.length, 7)
  assert.equal(partial.find(step => step.id === 'calendar').done, false)
  assert.equal(partial.find(step => step.id === 'invite').done, false)
  const complete = onboarding.buildOnboardingChecklist({ ...baseState, cloud: true, billingSettings: readySettings, officeCount: 1, serviceCount: 1, calendarConnected: true, patientCount: 1, dietCount: 1, inviteCount: 1 })
  assert.ok(complete.every(step => step.done))
})

test('preferenze avvio guidato: chiusura persistente e isolata per account', () => {
  const storage = memoryStorage()
  assert.equal(onboarding.readOnboardingDismissed('account-a', storage), false)
  onboarding.persistOnboardingDismissed('account-a', storage)
  assert.equal(onboarding.readOnboardingDismissed('account-a', storage), true)
  assert.equal(onboarding.readOnboardingDismissed('account-b', storage), false)
  assert.notEqual(onboarding.onboardingStorageKey('account-a'), onboarding.onboardingStorageKey('account-b'))
})

console.log('Importazione pazienti e avvio guidato verificati con dati fittizi locali.')
