import { Activity, AlertCircle, BookOpen, CalendarDays, CheckCircle2, ClipboardCheck, FileText, Printer, UserRound } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import type { Appointment, Patient } from '../types'
import { activePlanFor, ACTIVITY_MULTIPLIERS, adherenceForDays, dateKey, formatDate, formatDateTime, macroGrams, sumNutrients } from '../lib/clinical'
import { Modal, ProgressBar } from './UI'
import '../patient-report.css'

export default function PatientReport({ workspace, patient, appointment, onClose }: { workspace: Workspace; patient: Patient; appointment?: Appointment; onClose: () => void }) {
  const activePlan = activePlanFor(workspace.plans, patient.id)
  const targetKcal = activePlan?.calories ?? patient.calories
  const targetMacros = activePlan ? macroGrams(activePlan.calories, activePlan.plan.macroPercent) : { protein: patient.protein, carbs: patient.carbs, fat: patient.fat }
  const measurements = workspace.measurements.filter(item => item.patientId === patient.id).sort((a, b) => b.date.localeCompare(a.date))
  const latest = measurements[0]
  const previous = measurements[1]
  const weightDelta = latest && previous ? latest.weight - previous.weight : null
  const bmi = latest?.weight && patient.height > 0 ? latest.weight / ((patient.height / 100) ** 2) : null
  const patientAppointments = workspace.appointments.filter(item => item.patientId === patient.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const contextAppointment = appointment ?? patientAppointments.filter(item => item.startsAt >= new Date().toISOString())[0]
  const openTasks = workspace.notes.filter(note => note.patientId === patient.id && note.kind === 'Attività' && !note.done)
  const recentNotes = workspace.notes.filter(note => note.patientId === patient.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index)); const key = dateKey(date)
    const entries = workspace.diary.filter(entry => entry.patientId === patient.id && entry.date === key)
    const nutrients = sumNutrients(entries.flatMap(entry => { const food = workspace.foods.find(item => item.id === entry.foodId); return food ? [{ food, grams: entry.grams }] : [] }))
    return { key, entries: entries.length, kcal: nutrients.kcal, target: targetKcal }
  })
  const loggedDays = week.filter(day => day.entries > 0).length
  const adherence = adherenceForDays(week)
  const configuredDays = activePlan ? Object.values(activePlan.plan.days).filter(day => day.length && day.every(meal => meal.items.length)).length : 0
  const priorities = [
    loggedDays < 3 ? 'Verificare la compilazione del diario: meno di 3 giorni utili negli ultimi 7.' : null,
    !activePlan ? 'Nessun piano attivo disponibile per il confronto.' : null,
    activePlan?.status === 'Bozza' ? 'Il piano più recente è ancora in bozza: confermare cosa è stato consegnato.' : null,
    patient.anamnesis.allergies || patient.anamnesis.intolerances ? 'Rileggere allergie e intolleranze prima di eventuali sostituzioni.' : null,
    openTasks.length ? `${openTasks.length} attività di follow-up ancora aperte.` : null,
  ].filter((item): item is string => Boolean(item))

  return <Modal title={`Report · ${patient.name}`} description="Sempre aggiornato dai dati della cartella; il contesto della visita è facoltativo." onClose={onClose} wide>
    <div className="report-actions no-print"><span><CheckCircle2 size={15} />Aggiornato automaticamente all’apertura</span><button className="button primary" onClick={() => window.print()}><Printer size={16} />Stampa / salva PDF</button></div>
    <article id="print-area" className="patient-report-paper">
      <header className="report-header"><div><span className="report-brand">vatia</span><p>{workspace.billingSettings.studioName || 'Studio nutrizionale'}<br />{workspace.billingSettings.professionalName}</p></div><div><span>{contextAppointment ? 'REPORT PRE-VISITA' : 'REPORT PAZIENTE'}</span><strong>{patient.name}</strong><p>Generato il {formatDateTime(new Date().toISOString())}</p></div></header>
      {contextAppointment && <section className="report-appointment"><CalendarDays size={20} /><div><span>Visita collegata</span><strong>{contextAppointment.visitType} · {formatDateTime(contextAppointment.startsAt)}</strong>{contextAppointment.notes && <p>{contextAppointment.notes}</p>}</div></section>}
      <section className="report-section"><div className="report-section-title"><UserRound size={17} /><h2>Profilo e contesto</h2></div><div className="report-facts"><div><span>Età</span><strong>{patient.age} anni</strong></div><div><span>Obiettivo</span><strong>{patient.goal || 'Da definire'}</strong></div><div><span>Attività</span><strong>{ACTIVITY_MULTIPLIERS[patient.activityLevel].label}</strong></div><div><span>Alimentazione</span><strong>{patient.anamnesis.dietType}</strong></div></div><dl className="report-clinical-list"><div><dt>Allergie</dt><dd>{patient.anamnesis.allergies || 'Non registrate'}</dd></div><div><dt>Intolleranze</dt><dd>{patient.anamnesis.intolerances || 'Non registrate'}</dd></div><div><dt>Patologie</dt><dd>{patient.anamnesis.conditions || 'Non registrate'}</dd></div><div><dt>Farmaci</dt><dd>{patient.anamnesis.medications || 'Non registrati'}</dd></div><div><dt>Note cliniche</dt><dd>{patient.anamnesis.clinicalNotes || 'Nessuna nota'}</dd></div></dl></section>
      <section className="report-section"><div className="report-section-title"><Activity size={17} /><h2>Antropometria</h2></div>{latest ? <div className="report-facts"><div><span>Ultimo peso</span><strong>{latest.weight} kg</strong><small>{formatDate(latest.date)}</small></div><div><span>Variazione precedente</span><strong>{weightDelta == null ? '—' : `${weightDelta >= 0 ? '+' : ''}${weightDelta.toFixed(1)} kg`}</strong><small>{previous ? `dal ${formatDate(previous.date)}` : 'Serve una seconda rilevazione'}</small></div><div><span>BMI calcolato</span><strong>{bmi?.toFixed(1) ?? '—'}</strong><small>Valore descrittivo, non diagnostico</small></div><div><span>Circonferenze</span><strong>{latest.waist ? `${latest.waist} cm vita` : 'Non registrate'}</strong><small>{latest.bodyFat ? `Massa grassa ${latest.bodyFat}%` : ''}</small></div></div> : <p className="report-empty">Nessuna misurazione disponibile.</p>}</section>
      <section className="report-section"><div className="report-section-title"><BookOpen size={17} /><h2>Piano nutrizionale</h2></div>{activePlan ? <><div className="report-plan-heading"><div><strong>{activePlan.name}</strong><span>{activePlan.status} · aggiornato il {formatDate(activePlan.updatedAt.slice(0, 10))}</span></div><b>{activePlan.calories} kcal</b></div><div className="report-facts"><div><span>Proteine</span><strong>{targetMacros.protein} g</strong></div><div><span>Carboidrati</span><strong>{targetMacros.carbs} g</strong></div><div><span>Grassi</span><strong>{targetMacros.fat} g</strong></div><div><span>Giornate complete</span><strong>{configuredDays} / 7</strong></div></div></> : <p className="report-empty">Nessun piano disponibile.</p>}</section>
      <section className="report-section"><div className="report-section-title"><ClipboardCheck size={17} /><h2>Diario · ultimi 7 giorni</h2></div><div className="report-adherence"><div><strong>{loggedDays} / 7</strong><span>giorni registrati</span></div><div><strong>{loggedDays ? `${adherence}%` : '—'}</strong><span>giorni registrati nel target ±10%</span></div><ProgressBar value={adherence} /></div><div className="report-week">{week.map(day => <div key={day.key}><span>{formatDate(day.key, false)}</span><strong>{day.entries ? `${Math.round(day.kcal)} kcal` : 'Non registrato'}</strong><small>{day.entries} inserimenti</small></div>)}</div></section>
      <section className="report-section"><div className="report-section-title"><AlertCircle size={17} /><h2>Da verificare durante il follow-up</h2></div>{priorities.length ? <ul className="report-priorities">{priorities.map(item => <li key={item}>{item}</li>)}</ul> : <p className="report-empty">Nessuna priorità operativa automatica. Valuta il colloquio e il contesto clinico.</p>}</section>
      <section className="report-section"><div className="report-section-title"><FileText size={17} /><h2>Note recenti</h2></div>{recentNotes.length ? <div className="report-notes">{recentNotes.map(note => <div key={note.id}><span>{note.kind} · {formatDateTime(note.createdAt)}</span><p>{note.text}</p></div>)}</div> : <p className="report-empty">Nessuna nota nella timeline.</p>}</section>
      <footer className="report-footer">Report operativo generato dai dati presenti in Vatia. Gli scostamenti e le priorità non costituiscono diagnosi; verificare sempre il contesto prima delle decisioni cliniche.</footer>
    </article>
  </Modal>
}
