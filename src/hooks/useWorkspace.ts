import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { foods as baseFoods } from '../data/foods'
import { createEmptyDiet, normalizeDietData, uid } from '../lib/clinical'
import { EMPTY_ANAMNESIS } from '../types'
import type { Anamnesis, Appointment, DiaryEntry, DietPlan, Food, Measurement, Patient, PatientNote } from '../types'

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch { return fallback }
}

function useStored<T>(key: string, fallback: T, cloud: boolean) {
  const [value, setValue] = useState<T>(() => cloud ? fallback : readStored(key, fallback))
  useEffect(() => { if (!cloud) localStorage.setItem(key, JSON.stringify(value)) }, [key, cloud, value])
  return [value, setValue] as const
}

const patientFromRow = (row: Record<string, unknown>): Patient => ({
  id: String(row.id), name: String(row.name), age: Number(row.age ?? 0), email: String(row.email ?? ''),
  phone: String(row.phone ?? ''), sex: row.sex === 'female' ? 'female' : 'male', height: Number(row.height ?? 0),
  weight: Number(row.weight ?? 0), activityLevel: (row.activity_level ?? 'moderate') as Patient['activityLevel'],
  goal: String(row.goal ?? ''), status: (row.status ?? 'Attivo') as Patient['status'], calories: Number(row.calories ?? 0),
  protein: Number(row.protein_target ?? 0), carbs: Number(row.carbs_target ?? 0), fat: Number(row.fat_target ?? 0),
  anamnesis: { ...EMPTY_ANAMNESIS, ...((row.anamnesis ?? {}) as Partial<Anamnesis>) }, notes: String(row.notes ?? ''),
  createdAt: String(row.created_at ?? new Date().toISOString()), updatedAt: String(row.updated_at ?? new Date().toISOString()),
})

const foodFromRow = (row: Record<string, unknown>): Food => {
  const base = baseFoods.find(food => food.id === row.id)
  return {
    id: String(row.id), name: String(row.name), brand: String(row.brand ?? ''), barcode: String(row.barcode ?? ''),
    category: String(row.category ?? 'altro'), note: String(row.note ?? ''), source: String(row.source ?? ''),
    meals: (row.meals ?? base?.meals ?? 'all') as Food['meals'], per100g: row.per100g as Food['per100g'], isPublic: Boolean(row.is_public),
  }
}

const planFromRow = (row: Record<string, unknown>): DietPlan => {
  const calories = Number(row.calories ?? 0)
  return {
    id: String(row.id), patientId: String(row.patient_id), name: String(row.name), status: row.status === 'Pronta' ? 'Pronta' : 'Bozza',
    calories, plan: normalizeDietData((row.plan ?? {}) as DietPlan['plan'], calories), createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  }
}

export function useWorkspace(session: Session | null) {
  const cloud = Boolean(supabase && session)
  const [loading, setLoading] = useState(cloud)
  const [error, setError] = useState('')
  const [patients, setPatients] = useStored<Patient[]>('vatia-v3-patients', [], cloud)
  const [customFoods, setCustomFoods] = useStored<Food[]>('vatia-v3-foods', [], cloud)
  const [plans, setPlans] = useStored<DietPlan[]>('vatia-v3-plans', [], cloud)
  const [diary, setDiary] = useStored<DiaryEntry[]>('vatia-v3-diary', [], cloud)
  const [measurements, setMeasurements] = useStored<Measurement[]>('vatia-v3-measurements', [], cloud)
  const [notes, setNotes] = useStored<PatientNote[]>('vatia-v3-notes', [], cloud)
  const [appointments, setAppointments] = useStored<Appointment[]>('vatia-v3-appointments', [], cloud)
  const foods: Food[] = [...customFoods, ...(baseFoods as Food[]).filter(base => !customFoods.some(food => food.id === base.id))]

  const load = useCallback(async () => {
    if (!supabase || !session) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const [patientResult, foodResult, dietResult, diaryResult, measurementResult, noteResult, appointmentResult] = await Promise.all([
        supabase.from('patients').select('*').order('created_at'),
        supabase.from('foods').select('*').order('name'),
        supabase.from('diets').select('*').order('updated_at', { ascending: false }),
        supabase.from('diary_entries').select('*').order('created_at'),
        supabase.from('measurements').select('*').order('measured_on', { ascending: false }),
        supabase.from('patient_notes').select('*').order('created_at', { ascending: false }),
        supabase.from('appointments').select('*').order('starts_at'),
      ])
      const failure = [patientResult, foodResult, dietResult, diaryResult, measurementResult, noteResult, appointmentResult].find(result => result.error)
      if (failure?.error) throw failure.error
      setPatients((patientResult.data ?? []).map(row => patientFromRow(row)))
      setCustomFoods((foodResult.data ?? []).map(row => foodFromRow(row)))
      setPlans((dietResult.data ?? []).map(row => planFromRow(row)))
      setDiary((diaryResult.data ?? []).map(row => ({
        id: row.id, patientId: row.patient_id, date: row.entry_date, foodId: row.food_id, grams: Number(row.grams), meal: row.meal,
        source: row.source === 'patient' ? 'patient' : 'professional', note: row.note ?? '', createdAt: row.created_at,
      })))
      setMeasurements((measurementResult.data ?? []).map(row => ({
        id: row.id, patientId: row.patient_id, date: row.measured_on, weight: Number(row.weight), waist: row.waist == null ? undefined : Number(row.waist),
        hip: row.hip == null ? undefined : Number(row.hip), arm: row.arm == null ? undefined : Number(row.arm), thigh: row.thigh == null ? undefined : Number(row.thigh),
        bodyFat: row.body_fat == null ? undefined : Number(row.body_fat), note: row.note ?? '',
      })))
      setNotes((noteResult.data ?? []).map(row => ({ id: row.id, patientId: row.patient_id, text: row.text, kind: row.kind === 'Attività' ? 'Attività' : 'Nota', dueDate: row.due_date ?? undefined, done: row.done, createdAt: row.created_at })))
      setAppointments((appointmentResult.data ?? []).map(row => ({ id: row.id, patientId: row.patient_id, startsAt: row.starts_at, endsAt: row.ends_at, visitType: row.visit_type, notes: row.notes ?? '' })))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile caricare lo spazio di lavoro.')
    } finally { setLoading(false) }
  }, [session, setAppointments, setCustomFoods, setDiary, setMeasurements, setNotes, setPatients, setPlans])

  useEffect(() => { void load() }, [load])

  async function run<T>(operation: () => Promise<T>, fallback: () => T): Promise<T> {
    setError('')
    try { return cloud ? await operation() : fallback() }
    catch (cause) { const message = cause instanceof Error ? cause.message : 'Salvataggio non riuscito.'; setError(message); throw cause }
  }

  async function createPatient(input: Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>) {
    const now = new Date().toISOString()
    return run(async () => {
      const { data, error } = await supabase!.from('patients').insert({
        name: input.name, age: input.age, email: input.email || null, phone: input.phone || null, sex: input.sex, height: input.height,
        weight: input.weight, activity_level: input.activityLevel, goal: input.goal, status: input.status, calories: input.calories,
        protein_target: input.protein, carbs_target: input.carbs, fat_target: input.fat, anamnesis: input.anamnesis, notes: input.notes,
      }).select().single()
      if (error) throw error
      const patient = patientFromRow(data)
      setPatients(current => [...current, patient])
      return patient
    }, () => {
      const patient = { ...input, id: uid(), createdAt: now, updatedAt: now }
      setPatients(current => [...current, patient])
      return patient
    })
  }

  async function updatePatient(patient: Patient) {
    const updated = { ...patient, updatedAt: new Date().toISOString() }
    return run(async () => {
      const { error } = await supabase!.from('patients').update({
        name: updated.name, age: updated.age, email: updated.email || null, phone: updated.phone || null, sex: updated.sex,
        height: updated.height, weight: updated.weight, activity_level: updated.activityLevel, goal: updated.goal, status: updated.status,
        calories: updated.calories, protein_target: updated.protein, carbs_target: updated.carbs, fat_target: updated.fat,
        anamnesis: updated.anamnesis, notes: updated.notes, updated_at: updated.updatedAt,
      }).eq('id', updated.id)
      if (error) throw error
      setPatients(current => current.map(item => item.id === updated.id ? updated : item))
      return updated
    }, () => { setPatients(current => current.map(item => item.id === updated.id ? updated : item)); return updated })
  }

  async function addMeasurement(input: Omit<Measurement, 'id'>) {
    return run(async () => {
      const { data, error } = await supabase!.from('measurements').insert({ patient_id: input.patientId, measured_on: input.date, weight: input.weight, waist: input.waist ?? null, hip: input.hip ?? null, arm: input.arm ?? null, thigh: input.thigh ?? null, body_fat: input.bodyFat ?? null, note: input.note || null }).select().single()
      if (error) throw error
      const measurement: Measurement = { ...input, id: data.id }
      setMeasurements(current => [measurement, ...current])
      return measurement
    }, () => { const measurement = { ...input, id: uid() }; setMeasurements(current => [measurement, ...current]); return measurement })
  }

  async function addNote(input: Omit<PatientNote, 'id' | 'createdAt' | 'done'>) {
    return run(async () => {
      const { data, error } = await supabase!.from('patient_notes').insert({ patient_id: input.patientId, text: input.text, kind: input.kind, due_date: input.dueDate || null }).select().single()
      if (error) throw error
      const note: PatientNote = { ...input, id: data.id, done: false, createdAt: data.created_at }
      setNotes(current => [note, ...current]); return note
    }, () => { const note = { ...input, id: uid(), done: false, createdAt: new Date().toISOString() }; setNotes(current => [note, ...current]); return note })
  }

  async function toggleNote(note: PatientNote) {
    return run(async () => {
      const { error } = await supabase!.from('patient_notes').update({ done: !note.done }).eq('id', note.id)
      if (error) throw error
      setNotes(current => current.map(item => item.id === note.id ? { ...item, done: !item.done } : item))
    }, () => setNotes(current => current.map(item => item.id === note.id ? { ...item, done: !item.done } : item)))
  }

  async function saveDiet(plan: DietPlan) {
    return run(async () => {
      const { data, error } = await supabase!.from('diets').upsert({ id: plan.id, patient_id: plan.patientId, name: plan.name, status: plan.status, calories: plan.calories, plan: plan.plan, updated_at: new Date().toISOString() }).select().single()
      if (error) throw error
      const saved = planFromRow(data)
      setPlans(current => [saved, ...current.filter(item => item.id !== saved.id)])
      return saved
    }, () => {
      const saved = { ...plan, updatedAt: new Date().toISOString() }
      setPlans(current => [saved, ...current.filter(item => item.id !== saved.id)])
      return saved
    })
  }

  async function deleteDiet(id: string) {
    return run(async () => {
      const { error } = await supabase!.from('diets').delete().eq('id', id)
      if (error) throw error
      setPlans(current => current.filter(plan => plan.id !== id))
    }, () => setPlans(current => current.filter(plan => plan.id !== id)))
  }

  async function addDiaryEntry(input: Omit<DiaryEntry, 'id' | 'createdAt'>) {
    return run(async () => {
      const { data, error } = await supabase!.from('diary_entries').insert({ patient_id: input.patientId, food_id: input.foodId, entry_date: input.date, meal: input.meal, grams: input.grams, source: input.source, note: input.note || null }).select().single()
      if (error) throw error
      const entry = { ...input, id: data.id, createdAt: data.created_at }
      setDiary(current => [...current, entry]); return entry
    }, () => { const entry = { ...input, id: uid(), createdAt: new Date().toISOString() }; setDiary(current => [...current, entry]); return entry })
  }

  async function removeDiaryEntry(id: string) {
    return run(async () => {
      const { error } = await supabase!.from('diary_entries').delete().eq('id', id)
      if (error) throw error
      setDiary(current => current.filter(entry => entry.id !== id))
    }, () => setDiary(current => current.filter(entry => entry.id !== id)))
  }

  async function addFood(input: Omit<Food, 'id' | 'isPublic'>) {
    return run(async () => {
      const { data, error } = await supabase!.from('foods').insert({ id: `custom-${uid()}`, name: input.name, brand: input.brand || null, barcode: input.barcode || null, category: input.category, note: input.note || null, source: input.source || 'Alimento personale', meals: input.meals || 'all', per100g: input.per100g }).select().single()
      if (error) throw error
      const food = foodFromRow(data)
      setCustomFoods(current => [food, ...current]); return food
    }, () => { const food = { ...input, id: `custom-${uid()}` }; setCustomFoods(current => [food, ...current]); return food })
  }

  async function importFoods(imported: Food[]) {
    const valid = imported.filter(food => food.name && food.per100g && Number.isFinite(food.per100g.kcal))
    if (!valid.length) throw new Error('Il file non contiene alimenti validi.')
    return run(async () => {
      const rows = valid.map(food => ({ id: `import-${uid()}`, user_id: session!.user.id, name: food.name, brand: food.brand || null, barcode: food.barcode || null, category: food.category || 'altro', note: food.note || null, source: food.source || 'Importazione JSON', meals: food.meals || 'all', per100g: food.per100g, is_public: false }))
      const { data, error } = await supabase!.from('foods').insert(rows).select()
      if (error) throw error
      const saved = data.map(row => foodFromRow(row))
      setCustomFoods(current => [...saved, ...current]); return saved
    }, () => { const saved = valid.map(food => ({ ...food, id: `import-${uid()}` })); setCustomFoods(current => [...saved, ...current]); return saved })
  }

  async function addAppointment(input: Omit<Appointment, 'id'>) {
    return run(async () => {
      const { data, error } = await supabase!.from('appointments').insert({ patient_id: input.patientId || null, starts_at: input.startsAt, ends_at: input.endsAt, visit_type: input.visitType, notes: input.notes || null }).select().single()
      if (error) throw error
      const appointment = { ...input, id: data.id }
      setAppointments(current => [...current, appointment].sort((a, b) => a.startsAt.localeCompare(b.startsAt))); return appointment
    }, () => { const appointment = { ...input, id: uid() }; setAppointments(current => [...current, appointment]); return appointment })
  }

  async function deleteAppointment(id: string) {
    return run(async () => {
      const { error } = await supabase!.from('appointments').delete().eq('id', id)
      if (error) throw error
      setAppointments(current => current.filter(item => item.id !== id))
    }, () => setAppointments(current => current.filter(item => item.id !== id)))
  }

  return {
    loading, error, setError, patients, foods, customFoods, plans, diary, measurements, notes, appointments,
    createPatient, updatePatient, addMeasurement, addNote, toggleNote, saveDiet, deleteDiet, addDiaryEntry,
    removeDiaryEntry, addFood, importFoods, addAppointment, deleteAppointment, reload: load,
    emptyDiet: createEmptyDiet,
  }
}

export type Workspace = ReturnType<typeof useWorkspace>
