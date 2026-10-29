import { useEffect } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { Patient } from '../types'
import { initials } from '../lib/clinical'

export function Modal({ title, description, children, onClose, wide = false }: { title: string; description?: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><button className="icon-button modal-close" onClick={onClose} aria-label="Chiudi"><X size={19} /></button><div className="modal-title"><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</section></div>
}

export function PatientSelect({ patients, value, onChange, label = 'Seleziona paziente' }: { patients: Patient[]; value: string; onChange: (id: string) => void; label?: string }) {
  return <div className="select-wrap"><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{!patients.length && <option value="">Nessun paziente</option>}{patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select><ChevronDown size={14} /></div>
}

export function PatientAvatar({ patient, large = false }: { patient: Patient; large?: boolean }) {
  return <div className={`avatar soft ${large ? 'large' : ''}`}>{initials(patient.name)}</div>
}

export function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-state-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action && <div className="empty-state-action">{action}</div>}</div>
}

export function Field({ label, children, full = false, hint }: { label: string; children: React.ReactNode; full?: boolean; hint?: string }) {
  return <label className={full ? 'full' : ''}><span>{label}</span>{children}{hint && <small className="field-hint">{hint}</small>}</label>
}

export function ProgressBar({ value, warning = false }: { value: number; warning?: boolean }) {
  return <div className={`progress-track ${warning ? 'warning' : ''}`}><i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
}
