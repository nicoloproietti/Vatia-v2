import { useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, LoaderCircle, ShieldCheck, Upload, Users } from 'lucide-react'
import { csvDownload } from '../lib/clinical'
import { parsePatientCsv, PATIENT_CSV_TEMPLATE } from '../lib/patientImport'
import type { ParsedPatientImport, PatientImportRow } from '../lib/patientImport'
import type { Patient } from '../types'
import { Modal } from './UI'

export type PatientImportResult = {
  created: Pick<Patient, 'id' | 'name'>[]
  failures: { rowNumber: number; name: string; message: string }[]
}

export default function PatientImportModal({ existingPatients, onImport, onComplete, onClose }: {
  existingPatients: Patient[]
  onImport: (rows: PatientImportRow[]) => Promise<PatientImportResult>
  onComplete: (patientId: string) => void
  onClose: () => void
}) {
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedPatientImport | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PatientImportResult | null>(null)

  async function readFile(file?: File) {
    if (!file) return
    setReading(true); setError(''); setResult(null); setParsed(null); setFileName(file.name)
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Il file supera 5 MB. Dividi l’importazione in più file.')
      const next = parsePatientCsv(await file.text(), existingPatients)
      if (next.rows.length > 1000) throw new Error('Il file contiene più di 1.000 righe. Dividi l’importazione in più file.')
      setParsed(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile leggere il CSV.')
    } finally { setReading(false) }
  }

  async function confirmImport() {
    if (!parsed?.validRows.length || saving) return
    setSaving(true); setError('')
    try { setResult(await onImport(parsed.validRows)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Importazione non riuscita.') }
    finally { setSaving(false) }
  }

  return <Modal title="Importa pazienti da CSV" description="Controlla ogni riga prima di creare le cartelle. Nessun paziente viene salvato senza la tua conferma." onClose={() => { if (!saving) onClose() }} wide>
    <div className="patient-import-privacy"><ShieldCheck size={18} /><div><strong>Il file resta sul tuo dispositivo</strong><p>La lettura avviene localmente. Solo le righe valide che confermi vengono salvate nello spazio di lavoro.</p></div></div>
    {!result && <>
      <div className="patient-import-toolbar">
        <label className={`button secondary patient-file-picker ${reading ? 'disabled' : ''}`}><Upload size={16} />{reading ? 'Lettura in corso…' : fileName ? 'Scegli un altro CSV' : 'Scegli file CSV'}<input type="file" accept=".csv,text/csv" disabled={reading || saving} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = '' }} /></label>
        <button className="text-button" onClick={() => csvDownload('vatia-modello-pazienti.csv', PATIENT_CSV_TEMPLATE)}><Download size={15} />Scarica modello</button>
      </div>
      <p className="patient-import-help">Sono riconosciuti CSV italiani/Excel con virgola o punto e virgola. Il nome è obbligatorio; email, età, sesso, altezza, peso e obiettivo completano il profilo.</p>
      {fileName && <div className="patient-file-name"><FileSpreadsheet size={17} /><span>{fileName}</span>{parsed && <strong>{parsed.rows.length} righe lette</strong>}</div>}
      {error && <p className="voice-feedback error" role="alert">{error}</p>}
      {parsed && <div className="patient-import-preview">
        <div className="patient-import-summary"><span className="badge success"><CheckCircle2 size={13} />{parsed.validRows.length} pronte</span>{parsed.invalidCount > 0 && <span className="badge warning"><AlertCircle size={13} />{parsed.invalidCount} da correggere</span>}{parsed.duplicateCount > 0 && <span className="badge neutral">{parsed.duplicateCount} duplicati</span>}</div>
        <div className="patient-import-table" role="region" aria-label="Anteprima righe CSV" tabIndex={0}>
          <div className="patient-import-table-head"><span>Riga</span><span>Paziente</span><span>Contatti</span><span>Verifica</span></div>
          {parsed.rows.map(row => <div className={`patient-import-row ${row.errors.length ? 'invalid' : ''}`} key={row.rowNumber}>
            <span>{row.rowNumber}</span>
            <div><strong>{row.input.name || 'Nome mancante'}</strong><small>{[row.input.age && `${row.input.age} anni`, row.input.weight && `${row.input.weight} kg`, row.input.goal].filter(Boolean).join(' · ') || 'Dati aggiuntivi non indicati'}</small></div>
            <div><span>{row.input.email || 'Email non indicata'}</span><small>{row.input.phone || 'Telefono non indicato'}</small></div>
            <div>{row.errors.length ? <ul>{row.errors.map(message => <li key={message}>{message}</li>)}</ul> : <span className="import-row-valid"><CheckCircle2 size={14} />Pronta</span>}{row.notes.map(note => <small className="import-row-note" key={note}>{note}</small>)}</div>
          </div>)}
        </div>
        <div className="patient-import-confirm"><p>{parsed.invalidCount ? 'Le righe con errori saranno escluse; potrai correggerle e importarle in seguito.' : 'Tutte le righe sono pronte per il salvataggio.'}</p><button className="button primary" disabled={!parsed.validRows.length || saving} onClick={() => void confirmImport()}>{saving ? <LoaderCircle size={16} className="spin" /> : <Users size={16} />}{saving ? 'Creazione cartelle…' : `Importa ${parsed.validRows.length} ${parsed.validRows.length === 1 ? 'paziente' : 'pazienti'}`}</button></div>
      </div>}
    </>}
    {result && <div className="patient-import-result" role="status">
      <div className={`import-result-icon ${result.created.length ? '' : 'failed'}`}>{result.created.length ? <CheckCircle2 size={30} /> : <AlertCircle size={30} />}</div>
      <h3>{result.created.length} {result.created.length === 1 ? 'cartella creata' : 'cartelle create'}</h3>
      <p>{result.failures.length ? `${result.failures.length} operazioni non riuscite. Le cartelle già create non sono state eliminate.` : 'Profili e rilevazioni iniziali sono stati elaborati.'}</p>
      {result.failures.length > 0 && <ul className="import-result-errors">{result.failures.map(failure => <li key={`${failure.rowNumber}-${failure.message}`}><strong>Riga {failure.rowNumber} · {failure.name}</strong><span>{failure.message}</span></li>)}</ul>}
      <div className="patient-import-result-actions"><button className="button secondary" onClick={onClose}>Chiudi</button>{result.created.length > 0 && <button className="button primary" onClick={() => onComplete(result.created[0].id)}>Apri la prima cartella</button>}</div>
    </div>}
  </Modal>
}
