import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { foods as baseFoods } from '../data/foods'
import { createEmptyDiet, dateKey, macroGrams, normalizeDietData, uid } from '../lib/clinical'
import { optimizeItems, quickMealItems } from '../lib/dietEngine'
import { EMPTY_ANAMNESIS, EMPTY_BILLING_SETTINGS } from '../types'
import type { Anamnesis, Appointment, BillingSettings, DiaryEntry, DietPlan, Food, Invoice, Measurement, Patient, PatientNote, Service } from '../types'

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

const serviceFromRow = (row: Record<string, unknown>): Service => ({
  id: String(row.id), name: String(row.name), category: String(row.category ?? 'Visite'),
  duration: Number(row.duration ?? 45), price: Number(row.price ?? 0), active: Boolean(row.active),
})

const invoiceFromRow = (row: Record<string, unknown>): Invoice => ({
  id: String(row.id), number: String(row.number), patientId: String(row.patient_id), appointmentId: row.appointment_id ? String(row.appointment_id) : undefined,
  issueDate: String(row.issue_date), dueDate: String(row.due_date), serviceId: row.service_id ? String(row.service_id) : undefined,
  description: String(row.description ?? ''), amount: Number(row.amount ?? 0), enpab: Boolean(row.enpab), stamp: Boolean(row.stamp),
  status: (row.status ?? 'Bozza') as Invoice['status'], paymentMethod: String(row.payment_method ?? ''), paymentDate: row.payment_date ? String(row.payment_date) : undefined,
  recipientTaxCode: String(row.recipient_tax_code ?? ''), recipientAddress: String(row.recipient_address ?? ''), notes: String(row.notes ?? ''),
  createdAt: String(row.created_at ?? ''), updatedAt: String(row.updated_at ?? ''),
})

export function useWorkspace(session: Session | null) {
  const cloud = Boolean(supabase && session)
  const [loading, setLoading] = useState(cloud)
  const [error, setError] = useState('')
  const [billingWarning, setBillingWarning] = useState('')
  const [patients, setPatients] = useStored<Patient[]>('vatia-v3-patients', [], cloud)
  const [customFoods, setCustomFoods] = useStored<Food[]>('vatia-v3-foods', [], cloud)
  const [plans, setPlans] = useStored<DietPlan[]>('vatia-v3-plans', [], cloud)
  const [diary, setDiary] = useStored<DiaryEntry[]>('vatia-v3-diary', [], cloud)
  const [measurements, setMeasurements] = useStored<Measurement[]>('vatia-v3-measurements', [], cloud)
  const [notes, setNotes] = useStored<PatientNote[]>('vatia-v3-notes', [], cloud)
  const [appointments, setAppointments] = useStored<Appointment[]>('vatia-v3-appointments', [], cloud)
  const [services, setServices] = useStored<Service[]>('vatia-v3-services', [], cloud)
  const [invoices, setInvoices] = useStored<Invoice[]>('vatia-v3-invoices', [], cloud)
  const [billingSettings, setBillingSettings] = useStored<BillingSettings>('vatia-v3-billing-settings', EMPTY_BILLING_SETTINGS, cloud)
  const foods: Food[] = [...customFoods, ...(baseFoods as Food[]).filter(base => !customFoods.some(food => food.id === base.id))]

  const load = useCallback(async () => {
    if (!supabase || !session) { setLoading(false); return }
    setLoading(true); setError(''); setBillingWarning('')
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
      try {
        const [serviceResult, invoiceResult, settingsResult] = await Promise.all([
          supabase.from('services').select('*').order('name'),
          supabase.from('invoices').select('*').order('issue_date', { ascending: false }),
          supabase.from('billing_settings').select('*').maybeSingle(),
        ])
        const adminFailure = [serviceResult, invoiceResult, settingsResult].find(result => result.error)
        if (adminFailure?.error) throw adminFailure.error
        setServices((serviceResult.data ?? []).map(row => serviceFromRow(row)))
        setInvoices((invoiceResult.data ?? []).map(row => invoiceFromRow(row)))
        if (settingsResult.data) {
          const row = settingsResult.data
          setBillingSettings({
            studioName: String(row.studio_name ?? ''), professionalName: String(row.professional_name ?? ''), vatNumber: String(row.vat_number ?? ''),
            taxCode: String(row.tax_code ?? ''), address: String(row.address ?? ''), city: String(row.city ?? ''), postalCode: String(row.postal_code ?? ''),
            province: String(row.province ?? ''), enpabNumber: String(row.enpab_number ?? ''), email: String(row.email ?? ''), phone: String(row.phone ?? ''),
          })
        }
      } catch {
        setBillingWarning('La fatturazione cloud non è ancora configurata. Applica supabase/billing-schema.sql al progetto Vatia dedicato; i dati clinici restano disponibili.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile caricare lo spazio di lavoro.')
    } finally { setLoading(false) }
  }, [session, setAppointments, setCustomFoods, setDiary, setMeasurements, setNotes, setPatients, setPlans, setServices, setInvoices, setBillingSettings])

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

  async function addDiaryEntries(inputs: Omit<DiaryEntry, 'id' | 'createdAt'>[]) {
    if (!inputs.length) return []
    return run(async () => {
      const { data, error } = await supabase!.from('diary_entries').insert(inputs.map(input => ({ patient_id: input.patientId, food_id: input.foodId, entry_date: input.date, meal: input.meal, grams: input.grams, source: input.source, note: input.note || null }))).select()
      if (error) throw error
      const entries: DiaryEntry[] = data.map(row => ({ id: row.id, patientId: row.patient_id, date: row.entry_date, foodId: row.food_id, grams: Number(row.grams), meal: row.meal, source: row.source === 'patient' ? 'patient' : 'professional', note: row.note ?? '', createdAt: row.created_at }))
      setDiary(current => [...current, ...entries]); return entries
    }, () => {
      const createdAt = new Date().toISOString()
      const entries = inputs.map(input => ({ ...input, id: uid(), createdAt }))
      setDiary(current => [...current, ...entries]); return entries
    })
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
    const numberOrZero = (value: unknown) => {
      if (value == null || value === '') return 0
      const parsed = Number(value)
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN
    }
    const valid = imported.flatMap(food => {
      if (!food || typeof food.name !== 'string' || !food.name.trim() || !food.per100g) return []
      const per100g = {
        kcal: numberOrZero(food.per100g.kcal), protein: numberOrZero(food.per100g.protein),
        carbs: numberOrZero(food.per100g.carbs), fat: numberOrZero(food.per100g.fat), fiber: numberOrZero(food.per100g.fiber),
      }
      if (Object.values(per100g).some(value => !Number.isFinite(value))) return []
      const meals: Food['meals'] = food.meals === 'main' || food.meals === 'light' ? food.meals : 'all'
      const sanitized: Food = {
        ...food, name: food.name.trim(), category: typeof food.category === 'string' && food.category.trim() ? food.category.trim().toLowerCase() : 'altro',
        brand: typeof food.brand === 'string' ? food.brand.trim() : '', barcode: typeof food.barcode === 'string' ? food.barcode.trim() : '',
        note: typeof food.note === 'string' ? food.note.trim() : '', source: typeof food.source === 'string' && food.source.trim() ? food.source.trim() : 'Importazione JSON',
        meals, per100g, isPublic: false,
      }
      return [sanitized]
    })
    if (!valid.length) throw new Error('Il file non contiene alimenti validi: controlla nome e valori nutrizionali non negativi.')
    return run(async () => {
      const rows = valid.map(food => ({ id: `import-${uid()}`, user_id: session!.user.id, name: food.name, brand: food.brand || null, barcode: food.barcode || null, category: food.category, note: food.note || null, source: food.source, meals: food.meals, per100g: food.per100g, is_public: false }))
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

  async function updateAppointment(appointment: Appointment) {
    return run(async () => {
      const { error } = await supabase!.from('appointments').update({ patient_id: appointment.patientId || null, starts_at: appointment.startsAt, ends_at: appointment.endsAt, visit_type: appointment.visitType, notes: appointment.notes || null }).eq('id', appointment.id)
      if (error) throw error
      setAppointments(current => current.map(item => item.id === appointment.id ? appointment : item).sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
      return appointment
    }, () => { setAppointments(current => current.map(item => item.id === appointment.id ? appointment : item).sort((a, b) => a.startsAt.localeCompare(b.startsAt))); return appointment })
  }

  async function deleteAppointment(id: string) {
    return run(async () => {
      const { error } = await supabase!.from('appointments').delete().eq('id', id)
      if (error) throw error
      setAppointments(current => current.filter(item => item.id !== id))
    }, () => setAppointments(current => current.filter(item => item.id !== id)))
  }

  async function saveService(service: Service) {
    return run(async () => {
      const { data, error } = await supabase!.from('services').upsert({ id: service.id, name: service.name, category: service.category, duration: service.duration, price: service.price, active: service.active }).select().single()
      if (error) throw error
      const saved = serviceFromRow(data)
      setServices(current => [...current.filter(item => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)))
      return saved
    }, () => { setServices(current => [...current.filter(item => item.id !== service.id), service].sort((a, b) => a.name.localeCompare(b.name))); return service })
  }

  async function deleteService(id: string) {
    return run(async () => {
      const { error } = await supabase!.from('services').delete().eq('id', id)
      if (error) throw error
      setServices(current => current.filter(item => item.id !== id))
    }, () => setServices(current => current.filter(item => item.id !== id)))
  }

  async function saveInvoice(invoice: Invoice) {
    const updated = { ...invoice, updatedAt: new Date().toISOString() }
    return run(async () => {
      const { data, error } = await supabase!.from('invoices').upsert({
        id: updated.id, number: updated.number, patient_id: updated.patientId, appointment_id: updated.appointmentId || null,
        issue_date: updated.issueDate, due_date: updated.dueDate, service_id: updated.serviceId || null, description: updated.description,
        amount: updated.amount, enpab: updated.enpab, stamp: updated.stamp, status: updated.status, payment_method: updated.paymentMethod || null,
        payment_date: updated.paymentDate || null, recipient_tax_code: updated.recipientTaxCode || null, recipient_address: updated.recipientAddress || null,
        notes: updated.notes || null, updated_at: updated.updatedAt,
      }).select().single()
      if (error) throw error
      const saved = invoiceFromRow(data)
      setInvoices(current => [saved, ...current.filter(item => item.id !== saved.id)])
      return saved
    }, () => { setInvoices(current => [updated, ...current.filter(item => item.id !== updated.id)]); return updated })
  }

  async function deleteInvoice(id: string) {
    return run(async () => {
      const { error } = await supabase!.from('invoices').delete().eq('id', id)
      if (error) throw error
      setInvoices(current => current.filter(item => item.id !== id))
    }, () => setInvoices(current => current.filter(item => item.id !== id)))
  }

  async function saveBillingSettings(settings: BillingSettings) {
    return run(async () => {
      const { error } = await supabase!.from('billing_settings').upsert({
        user_id: session!.user.id, studio_name: settings.studioName, professional_name: settings.professionalName,
        vat_number: settings.vatNumber, tax_code: settings.taxCode, address: settings.address, city: settings.city,
        postal_code: settings.postalCode, province: settings.province, enpab_number: settings.enpabNumber, email: settings.email, phone: settings.phone,
      })
      if (error) throw error
      setBillingSettings(settings); return settings
    }, () => { setBillingSettings(settings); return settings })
  }

  function loadDemo() {
    if (cloud) return undefined
    const now = new Date()
    const timestamp = now.toISOString()
    const patientId = `demo-${uid()}`
    const patient: Patient = {
      id: patientId, name: 'Anna Neri (Demo)', age: 37, email: 'anna.demo@example.com', phone: '+39 333 000 0000', sex: 'female',
      height: 168, weight: 68.2, activityLevel: 'moderate', goal: 'Dimagrimento graduale · esempio', status: 'In follow-up', calories: 1800,
      ...macroGrams(1800, { protein: 30, carbs: 40, fat: 30 }),
      anamnesis: { ...EMPTY_ANAMNESIS, allergies: 'Nessuna allergia registrata (demo)', water: '1,8 L / giorno', clinicalNotes: 'Percorso dimostrativo locale: nessun dato clinico reale.' },
      notes: 'Dati dimostrativi, modificabili ed eliminabili dalla dashboard.', createdAt: timestamp, updatedAt: timestamp,
    }
    const data = createEmptyDiet(1800)
    const availableFoods = baseFoods as Food[]
    const template = data.days[0].map((meal, index) => {
      const kcal = Math.round(1800 * data.kcalPct[index] / 100)
      const target = { kcal, ...macroGrams(kcal, data.macroPercent) }
      return { ...meal, items: optimizeItems(quickMealItems(meal.name, availableFoods), availableFoods, target.kcal, target) }
    })
    data.days = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, template.map(meal => ({ ...meal, id: uid(), items: meal.items.map(item => ({ ...item, id: uid() })) }))]))
    const plan: DietPlan = { id: `demo-${uid()}`, patientId, name: 'Settimana mediterranea · Demo', status: 'Pronta', calories: 1800, plan: data, createdAt: timestamp, updatedAt: timestamp }
    const at = (offset: number) => { const date = new Date(now); date.setDate(now.getDate() + offset); return dateKey(date) }
    const demoMeasurements: Measurement[] = [-14, -7, 0].map((offset, index) => ({ id: `demo-${uid()}`, patientId, date: at(offset), weight: [69.8, 69, 68.2][index], waist: [82, 80, 78][index], note: index === 2 ? 'Rilevazione demo più recente' : undefined }))
    const demoDiary: DiaryEntry[] = data.days[(now.getDay() + 6) % 7].flatMap(meal => meal.items.map(item => ({ id: `demo-${uid()}`, patientId, date: dateKey(now), foodId: item.foodId, grams: Math.max(1, Math.round(item.grams * 0.98)), meal: meal.name, source: 'patient', note: 'Consumo dimostrativo', createdAt: timestamp })))
    const start = new Date(now); start.setDate(now.getDate() + 1); start.setHours(10, 30, 0, 0)
    const end = new Date(start.getTime() + 45 * 60000)
    const appointmentId = `demo-${uid()}`
    const serviceId = `demo-${uid()}`
    const demoServices: Service[] = [
      { id: serviceId, name: 'Prima visita nutrizionale', category: 'Visite', duration: 60, price: 120, active: true },
      { id: `demo-${uid()}`, name: 'Visita di controllo', category: 'Visite', duration: 45, price: 70, active: true },
      { id: `demo-${uid()}`, name: 'Piano nutrizionale', category: 'Piani', duration: 45, price: 90, active: true },
    ]
    const demoInvoice: Invoice = {
      id: `demo-${uid()}`, number: `${now.getFullYear()}-001`, patientId, appointmentId, issueDate: at(0), dueDate: at(14), serviceId: demoServices[1].id,
      description: 'Visita di controllo · percorso dimostrativo', amount: 70, enpab: true, stamp: false, status: 'Emessa', paymentMethod: '',
      recipientTaxCode: 'DEMO00000000D000', recipientAddress: 'Indirizzo dimostrativo, 1 · 00100 Roma (RM)', notes: 'Documento demo: non è una fattura fiscale.', createdAt: timestamp, updatedAt: timestamp,
    }
    setPatients(current => [...current, patient])
    setPlans(current => [plan, ...current])
    setMeasurements(current => [...demoMeasurements, ...current])
    setDiary(current => [...demoDiary, ...current])
    setNotes(current => [{ id: `demo-${uid()}`, patientId, text: 'Verificare il diario e preparare il follow-up dimostrativo', kind: 'Attività', dueDate: at(2), done: false, createdAt: timestamp }, ...current])
    setAppointments(current => [...current, { id: appointmentId, patientId, startsAt: start.toISOString(), endsAt: end.toISOString(), visitType: 'Visita di controllo', notes: 'Follow-up dimostrativo' }].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
    setServices(current => [...demoServices, ...current.filter(item => !item.id.startsWith('demo-'))])
    setInvoices(current => [demoInvoice, ...current])
    setBillingSettings({ studioName: 'Studio Vatia Demo', professionalName: 'Dott.ssa Vatia Demo', vatNumber: '00000000000', taxCode: 'DEMO00000000D000', address: 'Via dimostrativa 1', city: 'Roma', postalCode: '00100', province: 'RM', enpabNumber: '00000', email: 'studio.demo@example.com', phone: '+39 06 0000000' })
    return patient
  }

  function clearDemo() {
    setPatients(current => current.filter(item => !item.id.startsWith('demo-')))
    setPlans(current => current.filter(item => !item.patientId.startsWith('demo-')))
    setMeasurements(current => current.filter(item => !item.patientId.startsWith('demo-')))
    setDiary(current => current.filter(item => !item.patientId.startsWith('demo-')))
    setNotes(current => current.filter(item => !item.patientId.startsWith('demo-')))
    setAppointments(current => current.filter(item => !item.patientId?.startsWith('demo-')))
    setServices(current => current.filter(item => !item.id.startsWith('demo-')))
    setInvoices(current => current.filter(item => !item.id.startsWith('demo-')))
    if (billingSettings.studioName === 'Studio Vatia Demo') setBillingSettings(EMPTY_BILLING_SETTINGS)
  }

  return {
    loading, error, setError, billingWarning, patients, foods, customFoods, plans, diary, measurements, notes, appointments,
    services, invoices, billingSettings,
    createPatient, updatePatient, addMeasurement, addNote, toggleNote, saveDiet, deleteDiet, addDiaryEntry, addDiaryEntries,
    removeDiaryEntry, addFood, importFoods, addAppointment, updateAppointment, deleteAppointment,
    saveService, deleteService, saveInvoice, deleteInvoice, saveBillingSettings, loadDemo, clearDemo, reload: load,
    emptyDiet: createEmptyDiet,
  }
}

export type Workspace = ReturnType<typeof useWorkspace>
