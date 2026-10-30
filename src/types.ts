export type Page = 'oggi' | 'pazienti' | 'diario' | 'diete' | 'database' | 'insights' | 'calendario' | 'fatture'
export type InvoiceStatus = 'Bozza' | 'Emessa' | 'Pagata'

export type Service = {
  id: string
  name: string
  category: string
  duration: number
  price: number
  active: boolean
}

export type Invoice = {
  id: string
  number: string
  patientId: string
  appointmentId?: string
  issueDate: string
  dueDate: string
  serviceId?: string
  description: string
  amount: number
  enpab: boolean
  stamp: boolean
  status: InvoiceStatus
  paymentMethod: string
  paymentDate?: string
  recipientTaxCode: string
  recipientAddress: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type BillingSettings = {
  studioName: string
  professionalName: string
  vatNumber: string
  taxCode: string
  address: string
  city: string
  postalCode: string
  province: string
  enpabNumber: string
  email: string
  phone: string
}

export const EMPTY_BILLING_SETTINGS: BillingSettings = {
  studioName: '', professionalName: '', vatNumber: '', taxCode: '', address: '', city: '',
  postalCode: '', province: '', enpabNumber: '', email: '', phone: '',
}

export type MealType = 'main' | 'light'
export type Sex = 'male' | 'female'
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'veryActive'
export type DietStatus = 'Bozza' | 'Pronta'

export type Nutrients = {
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
}

export type Food = {
  id: string
  name: string
  category: string
  note?: string
  meals?: 'all' | 'main' | 'light'
  per100g: Nutrients
  brand?: string
  barcode?: string
  source?: string
  isPublic?: boolean
}

export type Anamnesis = {
  conditions: string
  medications: string
  allergies: string
  intolerances: string
  dietType: string
  mealsOut: string
  water: string
  alcohol: string
  smoking: string
  sleep: string
  stress: string
  supplements: string
  clinicalNotes: string
}

export type Patient = {
  id: string
  name: string
  age: number
  email: string
  phone: string
  sex: Sex
  height: number
  weight: number
  activityLevel: ActivityLevel
  goal: string
  status: 'Attivo' | 'In follow-up' | 'Archiviato'
  calories: number
  protein: number
  carbs: number
  fat: number
  anamnesis: Anamnesis
  notes: string
  createdAt: string
  updatedAt: string
}

export type Measurement = {
  id: string
  patientId: string
  date: string
  weight: number
  waist?: number
  hip?: number
  arm?: number
  thigh?: number
  bodyFat?: number
  note?: string
}

export type PatientNote = {
  id: string
  patientId: string
  text: string
  kind: 'Nota' | 'Attività'
  dueDate?: string
  done: boolean
  createdAt: string
}

export type PlanItem = {
  id: string
  foodId: string
  grams: number
}

export type PlannedMeal = {
  id: string
  name: string
  items: PlanItem[]
}

export type DietData = {
  macroPercent: { protein: number; carbs: number; fat: number }
  kcalPct: number[]
  days: Record<number, PlannedMeal[]>
}

export type DietPlan = {
  id: string
  patientId: string
  name: string
  status: DietStatus
  calories: number
  plan: DietData
  createdAt: string
  updatedAt: string
}

export type DiaryEntry = {
  id: string
  patientId: string
  date: string
  foodId: string
  grams: number
  meal: string
  source: 'professional' | 'patient'
  note: string
  createdAt: string
}

export type Appointment = {
  id: string
  patientId: string | null
  startsAt: string
  endsAt: string
  visitType: string
  notes: string
}

export const EMPTY_ANAMNESIS: Anamnesis = {
  conditions: '', medications: '', allergies: '', intolerances: '', dietType: 'Onnivora',
  mealsOut: '0', water: '', alcohol: 'No', smoking: 'No', sleep: '', stress: 'Moderato',
  supplements: '', clinicalNotes: '',
}

export const DAY_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
export const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
export const DEFAULT_MEAL_NAMES: Record<number, string[]> = {
  2: ['Pranzo', 'Cena'],
  3: ['Colazione', 'Pranzo', 'Cena'],
  4: ['Colazione', 'Spuntino', 'Pranzo', 'Cena'],
  5: ['Colazione', 'Spuntino', 'Pranzo', 'Spuntino', 'Cena'],
  6: ['Colazione', 'Spuntino', 'Pranzo', 'Spuntino', 'Cena', 'Spuntino'],
}
