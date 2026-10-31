import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, Mic, MicOff, ShieldCheck, Sparkles, Square, WandSparkles } from 'lucide-react'
import type { Anamnesis } from '../types'
import { analyzeAnamnesis, speechRecognitionAvailable, type AnamnesisAnalysis, type SpeechRecognitionInstance } from '../lib/voiceAnamnesis'
import { Modal } from './UI'

const labels: Record<keyof Anamnesis, string> = {
  conditions: 'Patologie e diagnosi', medications: 'Farmaci', allergies: 'Allergie', intolerances: 'Intolleranze',
  dietType: 'Tipo di alimentazione', mealsOut: 'Pasti fuori casa / settimana', water: 'Acqua abituale',
  alcohol: 'Alcol', smoking: 'Fumo', sleep: 'Sonno', stress: 'Stress percepito', supplements: 'Integratori', clinicalNotes: 'Note cliniche',
}

export default function VoiceAnamnesis({ current, onApply }: { current: Anamnesis; onApply: (values: Partial<Anamnesis>) => void }) {
  const [open, setOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [busy, setBusy] = useState(false)
  const [analysis, setAnalysis] = useState<AnamnesisAnalysis | null>(null)
  const [selected, setSelected] = useState<Set<keyof Anamnesis>>(new Set())
  const [error, setError] = useState('')
  const recognition = useRef<SpeechRecognitionInstance | null>(null)
  const finalTranscript = useRef('')
  const supported = speechRecognitionAvailable()
  const entries = analysis ? (Object.entries(analysis.values) as [keyof Anamnesis, string][]).filter(([, value]) => value.trim()) : []

  useEffect(() => () => recognition.current?.stop(), [])
  useEffect(() => { setAnalysis(null); setSelected(new Set()); setError('') }, [transcript])

  function close() {
    recognition.current?.stop()
    setListening(false)
    setOpen(false)
  }
  function toggleListening() {
    if (listening) { recognition.current?.stop(); setListening(false); return }
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Constructor) { setError('La dettatura non è supportata da questo browser. Puoi incollare o scrivere il testo e continuare con l’analisi.'); return }
    const instance = new Constructor()
    recognition.current = instance
    finalTranscript.current = transcript.trim() ? `${transcript.trim()} ` : ''
    instance.lang = 'it-IT'
    instance.continuous = true
    instance.interimResults = true
    instance.onresult = event => {
      let interim = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) finalTranscript.current += `${result[0].transcript.trim()} `
        else interim += result[0].transcript
      }
      setTranscript(`${finalTranscript.current}${interim}`.trimStart())
    }
    instance.onend = () => setListening(false)
    instance.onerror = event => {
      setListening(false)
      setError(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'Accesso al microfono negato. Autorizzalo nel browser oppure inserisci il testo manualmente.' : event.error === 'audio-capture' ? 'Nessun microfono disponibile. Verifica il dispositivo oppure scrivi il testo.' : 'La dettatura si è interrotta. Il testo già acquisito resta modificabile.')
    }
    setError('')
    try { instance.start(); setListening(true) } catch { setError('Impossibile avviare la dettatura in questo momento.') }
  }
  async function analyze() {
    setBusy(true)
    setError('')
    try {
      const result = await analyzeAnamnesis(transcript)
      const extracted = (Object.entries(result.values) as [keyof Anamnesis, string][]).filter(([, value]) => value.trim())
      if (!extracted.length) { setError('Non ho riconosciuto campi da compilare. Prova con frasi come “Allergie: nichel. Sonno: 7 ore.”'); return }
      setAnalysis(result)
      setSelected(new Set(extracted.filter(([key, value]) => current[key] !== value).map(([key]) => key)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Analisi non riuscita. Modifica il testo e riprova.')
    } finally { setBusy(false) }
  }
  function toggle(key: keyof Anamnesis) {
    setSelected(currentSelection => { const next = new Set(currentSelection); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  function apply() {
    if (!analysis || !selected.size) return
    const values: Partial<Anamnesis> = {}
    for (const [key, value] of entries) if (selected.has(key)) values[key] = value
    onApply(values)
    close()
  }

  return <>
    <button className="button secondary voice-anamnesis-trigger" type="button" onClick={() => setOpen(true)}><Mic size={15} />Detta anamnesi</button>
    {open && <Modal title="Assistente per l’anamnesi" description="Detta o incolla il colloquio: Vatia prepara i campi, tu controlli e decidi cosa applicare." onClose={close} wide>
      <div className="voice-privacy"><ShieldCheck size={19} /><div><strong>Tu mantieni il controllo clinico</strong><p>Nessun dato viene salvato automaticamente. La dettatura usa il riconoscimento vocale del browser; l’analisi AI sul dispositivo dipende dal supporto disponibile.</p></div></div>
      <div className="voice-transcript-heading"><label htmlFor="anamnesis-transcript">Testo del colloquio</label>{listening && <span className="recording-indicator" role="status"><i />Registrazione in corso</span>}</div>
      <textarea id="anamnesis-transcript" className="voice-transcript" rows={7} value={transcript} onChange={event => setTranscript(event.target.value)} placeholder="Es. Patologie: ipotiroidismo. Farmaci: levotiroxina 50 mcg. Allergie: nichel. Alimentazione vegetariana. Pasti fuori casa: 3. Acqua: 1,5 litri al giorno. Sonno: 7 ore. Stress: alto…" />
      <p className="voice-hint">Puoi dettare in modo naturale. Se usi l’analisi locale, separare gli argomenti con “Campo: valore” migliora la precisione.</p>
      <div className="voice-controls"><button className={`button secondary ${listening ? 'recording' : ''}`} type="button" disabled={!supported && !listening} onClick={toggleListening}>{listening ? <Square size={14} /> : supported ? <Mic size={15} /> : <MicOff size={15} />}{listening ? 'Interrompi dettatura' : supported ? 'Avvia dettatura' : 'Dettatura non supportata'}</button><button className="button primary" type="button" disabled={busy || listening || transcript.trim().length < 3} onClick={() => void analyze()}>{busy ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} />}{busy ? 'Analisi in corso…' : 'Analizza e prepara i campi'}</button></div>
      {error && <p className="voice-feedback error" role="alert">{error}</p>}
      {analysis && <section className="voice-review"><div className="voice-review-heading"><div><span className="eyebrow">ANTEPRIMA · {analysis.engine.toUpperCase()}</span><h3>Scegli i campi da applicare</h3></div><span className="badge neutral">{entries.length} riconosciuti</span></div>{analysis.notice && <p className="voice-feedback notice">{analysis.notice}</p>}<div className="voice-field-list">{entries.map(([key, value]) => <label key={key} className={selected.has(key) ? 'selected' : ''}><input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} /><span><strong>{labels[key]}</strong><b>{value}</b>{current[key] && current[key] !== value && <small>Sostituirà: {current[key]}</small>}{current[key] === value && <small>Coincide con il valore già presente</small>}</span>{selected.has(key) && <Check size={16} />}</label>)}</div><div className="voice-review-footer"><span>Controlla sempre i dati prima del salvataggio clinico.</span><button className="button primary" type="button" disabled={!selected.size} onClick={apply}><Sparkles size={15} />Applica {selected.size} {selected.size === 1 ? 'campo' : 'campi'}</button></div></section>}
    </Modal>}
  </>
}
