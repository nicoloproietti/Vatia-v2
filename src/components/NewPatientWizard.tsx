import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, UserRound } from 'lucide-react'
import { ACTIVITY_MULTIPLIERS, calculateBMR, calculateTDEE, macroGrams } from '../lib/clinical'
import { EMPTY_ANAMNESIS } from '../types'
import type { ActivityLevel, Patient, Sex } from '../types'
import { Field, Modal } from './UI'

type Draft = {
  name: string; email: string; phone: string; age: string; sex: Sex; height: string; weight: string
  activityLevel: ActivityLevel; goal: string; objective: 'loss' | 'maintain' | 'gain'; calories: number
}

const initial: Draft = { name: '', email: '', phone: '', age: '', sex: 'female', height: '', weight: '', activityLevel: 'moderate', goal: 'Mantenimento del peso', objective: 'maintain', calories: 0 }

export default function NewPatientWizard({ onClose, onCreate }: { onClose: () => void; onCreate: (input: Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>, openDiet: boolean) => Promise<void> }) {
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }))
  const patientShape = { age: Number(draft.age), sex: draft.sex, height: Number(draft.height), weight: Number(draft.weight), activityLevel: draft.activityLevel }
  const bmr = patientShape.weight && patientShape.height && patientShape.age ? calculateBMR(patientShape.weight, patientShape.height, patientShape.age, patientShape.sex) : 0
  const tdee = calculateTDEE(patientShape)
  const suggested = useMemo(() => Math.round(tdee * (draft.objective === 'loss' ? 0.85 : draft.objective === 'gain' ? 1.1 : 1)), [tdee, draft.objective])
  const calories = draft.calories || suggested
  const valid = step === 0 ? draft.name.trim().length > 1 : step === 1 ? Number(draft.age) >= 10 && Number(draft.height) >= 100 && Number(draft.weight) >= 30 : calories >= 800 && draft.goal.trim().length > 1

  async function create(openDiet: boolean) {
    if (!valid || saving) return
    setSaving(true)
    const macros = macroGrams(calories, { protein: 30, carbs: 40, fat: 30 })
    try {
      await onCreate({ name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim(), age: Number(draft.age), sex: draft.sex,
        height: Number(draft.height), weight: Number(draft.weight), activityLevel: draft.activityLevel, goal: draft.goal.trim(), status: 'Attivo',
        calories, ...macros, anamnesis: { ...EMPTY_ANAMNESIS }, notes: '' }, openDiet)
    } finally { setSaving(false) }
  }

  return <Modal title="Nuovo paziente" description="Tre passaggi: i dati verranno riutilizzati in anamnesi, misurazioni e diete." onClose={onClose} wide>
    <div className="wizard-steps" aria-label="Avanzamento">{['Contatti', 'Profilo metabolico', 'Obiettivo'].map((label, index) => <button key={label} className={index === step ? 'active' : index < step ? 'done' : ''} onClick={() => { if (index < step) setStep(index) }}><span>{index < step ? <Check size={13} /> : index + 1}</span>{label}</button>)}</div>
    <div className="wizard-body">
      {step === 0 && <div className="form-grid"><Field label="Nome e cognome" full><input autoFocus name="name" value={draft.name} onChange={event => update('name', event.target.value)} placeholder="Es. Anna Neri" /></Field><Field label="Email"><input name="email" type="email" value={draft.email} onChange={event => update('email', event.target.value)} placeholder="anna@email.it" /></Field><Field label="Telefono"><input name="phone" type="tel" value={draft.phone} onChange={event => update('phone', event.target.value)} placeholder="+39 333 123 4567" /></Field><div className="wizard-callout full"><UserRound size={19} /><div><strong>Nessun dato duplicato</strong><span>Il profilo alimenterà automaticamente il builder della dieta.</span></div></div></div>}
      {step === 1 && <><div className="form-grid"><Field label="Età"><input name="age" type="number" min="10" max="120" value={draft.age} onChange={event => update('age', event.target.value)} placeholder="35" /></Field><Field label="Sesso biologico"><select name="sex" value={draft.sex} onChange={event => update('sex', event.target.value as Sex)}><option value="female">Donna</option><option value="male">Uomo</option></select></Field><Field label="Altezza (cm)"><input name="height" type="number" min="100" max="250" value={draft.height} onChange={event => update('height', event.target.value)} placeholder="168" /></Field><Field label="Peso attuale (kg)"><input name="weight" type="number" min="30" max="300" step="0.1" value={draft.weight} onChange={event => update('weight', event.target.value)} placeholder="65" /></Field><Field label="Livello di attività" full><select name="activityLevel" value={draft.activityLevel} onChange={event => update('activityLevel', event.target.value as ActivityLevel)}>{Object.entries(ACTIVITY_MULTIPLIERS).map(([key, item]) => <option key={key} value={key}>{item.label} · {item.description}</option>)}</select></Field></div>{tdee > 0 && <div className="metabolic-preview"><div><span>Metabolismo basale</span><strong>{bmr} kcal</strong></div><div><span>Fabbisogno stimato</span><strong>{tdee} kcal</strong></div><small>Mifflin–St Jeor · potrai modificare ogni valore</small></div>}</>}
      {step === 2 && <><div className="objective-grid">{([['loss', 'Dimagrimento', '−15% dal TDEE'], ['maintain', 'Mantenimento', 'Fabbisogno stimato'], ['gain', 'Aumento massa', '+10% dal TDEE']] as const).map(([id, label, note]) => <button key={id} className={draft.objective === id ? 'active' : ''} onClick={() => { update('objective', id); update('calories', 0) }}><strong>{label}</strong><span>{note}</span><b>{Math.round(tdee * (id === 'loss' ? 0.85 : id === 'gain' ? 1.1 : 1))} kcal</b></button>)}</div><div className="form-grid objective-fields"><Field label="Obiettivo nutrizionale" full><input name="goal" value={draft.goal} onChange={event => update('goal', event.target.value)} /></Field><Field label="Target calorico giornaliero" full hint="Il target resta sempre modificabile nel builder."><input name="calories" type="number" min="800" step="10" value={calories || ''} onChange={event => update('calories', Number(event.target.value))} /></Field></div></>}
    </div>
    <div className="wizard-actions"><button className="button secondary" onClick={() => step ? setStep(step - 1) : onClose()}>{step ? <ArrowLeft size={16} /> : null}{step ? 'Indietro' : 'Annulla'}</button>{step < 2 ? <button className="button primary" disabled={!valid} onClick={() => setStep(step + 1)}>Continua<ArrowRight size={16} /></button> : <div className="heading-actions"><button className="button secondary" disabled={!valid || saving} onClick={() => void create(false)}>Crea paziente</button><button className="button primary" disabled={!valid || saving} onClick={() => void create(true)}>{saving ? 'Salvataggio…' : 'Crea e prepara dieta'}<ArrowRight size={16} /></button></div>}</div>
  </Modal>
}
