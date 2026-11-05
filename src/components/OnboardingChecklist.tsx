import { useState, type ReactNode } from 'react'
import { ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, Upload, X } from 'lucide-react'
import type { OnboardingStep, OnboardingStepId } from '../lib/onboarding'
import VatiaBuddy from './VatiaBuddy'

export default function OnboardingChecklist({ steps, actions, onImport, onDismiss, googleConnection }: {
  steps: OnboardingStep[]
  actions: Partial<Record<OnboardingStepId, () => void>>
  onImport: () => void
  onDismiss: () => void
  googleConnection?: ReactNode
}) {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const completed = steps.filter(step => step.done).length
  const progress = steps.length ? Math.round(completed / steps.length * 100) : 100

  return <section className="panel guided-setup" aria-label="Avvio guidato">
    <div className="guided-setup-heading">
      <div className="guided-setup-buddy"><VatiaBuddy size={58} /></div>
      <div><span className="eyebrow">AVVIO GUIDATO</span><h2>{completed === steps.length ? 'Il tuo studio è pronto.' : 'Configura Vatia una sola volta.'}</h2><p>{completed === steps.length ? 'Hai completato il percorso iniziale: puoi chiudere questa checklist e personalizzare la dashboard.' : 'Ogni passaggio prepara il successivo: meno inserimenti, meno passaggi ripetuti durante le visite.'}</p></div>
      <div className="guided-setup-progress"><strong>{completed}/{steps.length}</strong><span>completati</span></div>
      <button className="icon-button" title="Chiudi avvio guidato" aria-label="Chiudi avvio guidato" onClick={onDismiss}><X size={18} /></button>
    </div>
    <div className="guided-progress-track" aria-label={`Avvio guidato completato al ${progress}%`}><i style={{ width: `${progress}%` }} /></div>
    <div className="guided-steps">
      {steps.map((step, index) => <article className={`guided-step ${step.done ? 'done' : ''}`} key={step.id}>
        <span className="guided-step-index">{step.done ? <Check size={15} /> : index + 1}</span>
        <div className="guided-step-copy"><strong>{step.title}</strong><p>{step.description}</p></div>
        {!step.done && <div className="guided-step-actions">
          {step.id === 'patient' && <button className="button secondary compact" onClick={onImport}><Upload size={14} />Importa CSV</button>}
          <button className="button secondary compact" onClick={() => step.id === 'calendar' ? setCalendarOpen(current => !current) : actions[step.id]?.()}>{step.id === 'calendar' && (calendarOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}{step.id === 'calendar' ? calendarOpen ? 'Nascondi collegamento' : step.actionLabel : step.actionLabel}{step.id !== 'calendar' && <ArrowRight size={14} />}</button>
        </div>}
        {step.done && <CheckCircle2 className="guided-step-check" size={19} />}
        {step.id === 'calendar' && calendarOpen && !step.done && googleConnection && <div className="guided-calendar-connection">{googleConnection}</div>}
      </article>)}
    </div>
  </section>
}
