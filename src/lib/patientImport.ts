import Papa from 'papaparse'
import { calculateTDEE, macroGrams } from './clinical'
import { EMPTY_ANAMNESIS } from '../types'
import type { ActivityLevel, Patient, Sex } from '../types'

export type NewPatientInput = Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>
export type PatientImportRow = {
  rowNumber: number
  input: NewPatientInput
  errors: string[]
  notes: string[]
  duplicate: boolean
}
export type ParsedPatientImport = {
  rows: PatientImportRow[]
  validRows: PatientImportRow[]
  invalidCount: number
  duplicateCount: number
}

const normalizeHeader = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const normalizeIdentity = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
const normalizeEmail = (value: string) => value.trim().toLowerCase()

const headers: Record<string, string> = {
  nome: 'name', nomeecognome: 'name', name: 'name', fullname: 'name', paziente: 'name',
  email: 'email', mail: 'email', indirizzoemail: 'email',
  telefono: 'phone', phone: 'phone', cellulare: 'phone', telefonocellulare: 'phone',
  eta: 'age', age: 'age', anni: 'age',
  sesso: 'sex', sex: 'sex', sessobiologico: 'sex',
  altezza: 'height', height: 'height', altezzacm: 'height', stature: 'height',
  peso: 'weight', weight: 'weight', pesokg: 'weight', pesoattuale: 'weight',
  obiettivo: 'goal', goal: 'goal', obiettivonutrizionale: 'goal',
  attivita: 'activity', activity: 'activity', livelloattivita: 'activity', livellodiattivita: 'activity',
}

const activities: Record<string, ActivityLevel> = {
  sedentario: 'sedentary', sedentary: 'sedentary', leggero: 'light', light: 'light',
  moderato: 'moderate', moderate: 'moderate', attivo: 'active', active: 'active',
  moltoattivo: 'veryActive', veryactive: 'veryActive',
}

function numberValue(raw: string, label: string, min: number, max: number, errors: string[]) {
  const value = raw.trim()
  if (!value) return 0
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    errors.push(`${label} deve essere un numero tra ${min} e ${max}.`)
    return 0
  }
  return parsed
}

function sexValue(raw: string, errors: string[]): Sex | null {
  const value = normalizeHeader(raw)
  if (!value) return null
  if (['female', 'f', 'donna', 'femmina'].includes(value)) return 'female'
  if (['male', 'm', 'uomo', 'maschio'].includes(value)) return 'male'
  errors.push('Sesso non riconosciuto: usa Donna/Uomo oppure Female/Male.')
  return 'female'
}

export function parsePatientCsv(text: string, existingPatients: Pick<Patient, 'name' | 'email'>[] = []): ParsedPatientImport {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: header => headers[normalizeHeader(header)] ?? normalizeHeader(header),
  })
  if (!result.meta.fields?.includes('name')) throw new Error('Manca la colonna Nome. Scarica il modello CSV per verificare le intestazioni.')
  if (!result.data.length) throw new Error('Il CSV non contiene righe paziente.')
  const fatal = result.errors.find(error => error.code === 'TooFewFields' || error.code === 'TooManyFields')
  if (fatal) throw new Error(`Struttura CSV non leggibile alla riga ${(fatal.row ?? 0) + 2}: ${fatal.message}`)

  const existingEmails = new Set(existingPatients.map(patient => normalizeEmail(patient.email)).filter(Boolean))
  const existingNames = new Set(existingPatients.map(patient => normalizeIdentity(patient.name)).filter(Boolean))
  const seenEmails = new Set<string>()
  const seenNames = new Set<string>()

  const rows = result.data.map((row, index): PatientImportRow => {
    const errors: string[] = []
    const notes: string[] = []
    const name = String(row.name ?? '').trim()
    const email = normalizeEmail(String(row.email ?? ''))
    const normalizedName = normalizeIdentity(name)
    if (normalizedName.length < 2) errors.push('Nome e cognome obbligatori (almeno 2 caratteri).')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email non valida.')
    const age = numberValue(String(row.age ?? ''), 'Età', 10, 120, errors)
    const height = numberValue(String(row.height ?? ''), 'Altezza', 100, 250, errors)
    const weight = numberValue(String(row.weight ?? ''), 'Peso', 30, 300, errors)
    const sex = sexValue(String(row.sex ?? ''), errors)
    if (!sex) notes.push('Sesso biologico non indicato: valore provvisorio Donna da verificare; nessun target calorico calcolato.')
    const activityRaw = normalizeHeader(String(row.activity ?? ''))
    if (activityRaw && !activities[activityRaw]) errors.push('Attività non riconosciuta: usa Sedentario, Leggero, Moderato, Attivo o Molto attivo.')
    const activityLevel = activities[activityRaw] ?? 'moderate'

    let duplicate = false
    if (email && (existingEmails.has(email) || seenEmails.has(email))) {
      errors.push('Duplicato: email già presente nello studio o in una riga precedente.')
      duplicate = true
    }
    if (normalizedName && (existingNames.has(normalizedName) || seenNames.has(normalizedName))) {
      errors.push('Duplicato: nome già presente nello studio o in una riga precedente.')
      duplicate = true
    }
    if (email) seenEmails.add(email)
    if (normalizedName) seenNames.add(normalizedName)

    const shape = { age, height, weight, sex: sex ?? 'female', activityLevel }
    const calories = sex ? calculateTDEE(shape) : 0
    const macros = macroGrams(calories, { protein: 30, carbs: 40, fat: 30 })
    return {
      rowNumber: index + 2,
      errors,
      notes,
      duplicate,
      input: {
        name, email, phone: String(row.phone ?? '').trim(), age, height, weight, activityLevel,
        sex: sex ?? 'female', goal: String(row.goal ?? '').trim(), status: 'Attivo', calories, ...macros,
        anamnesis: { ...EMPTY_ANAMNESIS }, notes: '',
      },
    }
  })
  return {
    rows,
    validRows: rows.filter(row => !row.errors.length),
    invalidCount: rows.filter(row => row.errors.length).length,
    duplicateCount: rows.filter(row => row.duplicate).length,
  }
}

export const PATIENT_CSV_TEMPLATE: (string | number)[][] = [
  ['Nome', 'Email', 'Telefono', 'Età', 'Sesso', 'Altezza', 'Peso', 'Obiettivo', 'Attività'],
  ['Anna Esempio', 'anna.esempio@example.com', '+39 333 000 0000', 35, 'Donna', 168, '65,5', 'Mantenimento del peso', 'Moderato'],
]
