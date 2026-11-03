import { useEffect, useRef, useState } from 'react'
import { Check, Download, LoaderCircle, Mic, MicOff, ShieldCheck, Sparkles, Square, WandSparkles } from 'lucide-react'
import type { Anamnesis } from '../types'
import {
  ANAMNESIS_KEYS,
  analyzeAnamnesis,
  buildSelectedValues,
  collectSpeechResults,
  createLocalSpeechRecognition,
  getReviewConflicts,
  inspectLanguageModel,
  inspectSpeechRecognition,
  installItalianSpeechRecognition,
  type AnamnesisAnalysis,
  type ModelCapability,
  type SpeechCapability,
  type SpeechRecognitionInstance,
} from '../lib/voiceAnamnesis'
import { Modal } from './UI'

const labels: Record<keyof Anamnesis, string> = {
  conditions: 'Patologie e diagnosi', medications: 'Farmaci', allergies: 'Allergie', intolerances: 'Intolleranze',
  dietType: 'Tipo di alimentazione', mealsOut: 'Pasti fuori casa / settimana', water: 'Acqua abituale',
  alcohol: 'Alcol', smoking: 'Fumo', sleep: 'Sonno', stress: 'Stress percepito', supplements: 'Integratori', clinicalNotes: 'Note cliniche',
}

const initialSpeechCapability: SpeechCapability = { canStart: false, canInstall: false, status: 'unknown', message: 'Verifica della dettatura italiana sul dispositivo…' }
const initialModelCapability: ModelCapability = { status: 'unknown', message: 'Verifica del modello linguistico locale…' }
const PROGRESSIVE_DELAY_MS = 1200

type ReviewSource = { transcript: string; current: Anamnesis }

export default function VoiceAnamnesis({ current, onApply }: { current: Anamnesis; onApply: (values: Partial<Anamnesis>) => void }) {
  const [open, setOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [speechBusy, setSpeechBusy] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [analysis, setAnalysis] = useState<AnamnesisAnalysis | null>(null)
  const [drafts, setDrafts] = useState<Partial<Anamnesis>>({})
  const [selected, setSelected] = useState<Set<keyof Anamnesis>>(new Set())
  const [reviewSource, setReviewSource] = useState<ReviewSource | null>(null)
  const [speechCapability, setSpeechCapability] = useState<SpeechCapability>(initialSpeechCapability)
  const [modelCapability, setModelCapability] = useState<ModelCapability>(initialModelCapability)
  const [error, setError] = useState('')
  const recognition = useRef<SpeechRecognitionInstance | null>(null)
  const finalTranscript = useRef('')
  const transcriptRef = useRef('')
  const currentRef = useRef(current)
  const analysisRun = useRef(0)
  const speechRequest = useRef(0)
  const progressiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editedFields = useRef<Set<keyof Anamnesis>>(new Set())
  currentRef.current = current

  const entries = analysis ? ANAMNESIS_KEYS.filter(key => analysis.values[key]?.trim() || drafts[key]?.trim()) : []
  const sourceStale = Boolean(analysis && reviewSource && reviewSource.transcript !== transcript)
  const conflicts = reviewSource ? getReviewConflicts(reviewSource.current, current) : []
  const selectedConflicts = conflicts.filter(key => selected.has(key))

  useEffect(() => {
    if (!open) return
    let active = true
    void inspectSpeechRecognition().then(capability => { if (active) setSpeechCapability(capability) })
    void inspectLanguageModel().then(capability => { if (active) setModelCapability(capability) })
    return () => { active = false }
  }, [open])

  useEffect(() => () => {
    if (progressiveTimer.current) clearTimeout(progressiveTimer.current)
    analysisRun.current += 1
    speechRequest.current += 1
    const instance = recognition.current
    if (instance) {
      instance.onresult = null
      instance.onend = null
      instance.onerror = null
      try { instance.stop() } catch { /* Il browser potrebbe aver già rilasciato il riconoscimento. */ }
    }
  }, [])

  function stopRecognition() {
    speechRequest.current += 1
    const instance = recognition.current
    recognition.current = null
    if (instance) {
      instance.onresult = null
      instance.onend = null
      instance.onerror = null
      try { instance.stop() } catch { /* Lo stop è best-effort secondo l’API del browser. */ }
    }
    setListening(false)
    setInterim('')
  }

  function close() {
    if (progressiveTimer.current) clearTimeout(progressiveTimer.current)
    analysisRun.current += 1
    stopRecognition()
    setBusy(false)
    setSpeechBusy(false)
    setOpen(false)
  }

  function commitTranscript(next: string, progressive: boolean) {
    transcriptRef.current = next
    setTranscript(next)
    analysisRun.current += 1
    setBusy(false)
    setError('')
    if (progressiveTimer.current) clearTimeout(progressiveTimer.current)
    if (progressive && next.trim().length >= 3) {
      const text = next
      progressiveTimer.current = setTimeout(() => { void runAnalysis(text, true) }, PROGRESSIVE_DELAY_MS)
    }
  }

  async function startListening() {
    const request = ++speechRequest.current
    setSpeechBusy(true)
    setError('')
    setStatus('Verifica della dettatura italiana locale…')
    try {
      const instance = await createLocalSpeechRecognition()
      if (request !== speechRequest.current) {
        try { instance.stop() } catch { /* Istanza mai avviata o già rilasciata. */ }
        return
      }
      recognition.current = instance
      finalTranscript.current = transcriptRef.current.trim()
      instance.onresult = event => {
        const result = collectSpeechResults(event)
        setInterim(result.interim)
        if (!result.final) return
        const next = `${finalTranscript.current} ${result.final}`.trim()
        finalTranscript.current = next
        commitTranscript(next, true)
      }
      instance.onend = () => {
        if (recognition.current === instance) recognition.current = null
        setListening(false)
        setInterim('')
      }
      instance.onerror = event => {
        stopRecognition()
        setError(
          event.error === 'not-allowed' || event.error === 'service-not-allowed'
            ? 'Accesso al microfono negato. Autorizzalo nel browser oppure inserisci il testo manualmente.'
            : event.error === 'audio-capture'
              ? 'Nessun microfono disponibile. Verifica il dispositivo oppure scrivi il testo.'
              : event.error === 'language-not-supported'
                ? 'Il pacchetto italiano locale non è utilizzabile. Installa il pacchetto oppure usa il testo manuale.'
                : 'La dettatura locale si è interrotta. Non verrà ripresa automaticamente e non verrà usata una dettatura cloud; il testo acquisito resta modificabile.',
        )
      }
      instance.start()
      setListening(true)
      setStatus('Dettatura locale attiva. Solo i risultati finali alimenteranno la bozza.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossibile avviare la dettatura locale. Usa il testo manuale.')
    } finally {
      if (request === speechRequest.current) setSpeechBusy(false)
    }
  }

  async function installSpeechPack() {
    setSpeechBusy(true)
    setError('')
    setStatus('Installazione del pacchetto italiano per la dettatura sul dispositivo…')
    try {
      const capability = await installItalianSpeechRecognition()
      setSpeechCapability(capability)
      setStatus(capability.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Installazione del pacchetto italiano non riuscita.')
    } finally {
      setSpeechBusy(false)
    }
  }

  async function runAnalysis(text: string, automatic = false) {
    if (progressiveTimer.current) clearTimeout(progressiveTimer.current)
    if (!text.trim()) {
      setError('Detta o inserisci prima il testo dell’anamnesi.')
      return
    }
    const request = ++analysisRun.current
    setBusy(true)
    setError('')
    setStatus(automatic ? 'Analisi progressiva di un batch di risultati finali…' : 'Preparazione della bozza…')
    try {
      const result = await analyzeAnamnesis(text, {
        onStatus: message => { if (request === analysisRun.current) setStatus(message) },
      })
      if (request !== analysisRun.current || transcriptRef.current !== text) return
      const extracted = ANAMNESIS_KEYS.filter(key => result.values[key]?.trim())
      if (!extracted.length) {
        if (!automatic) setError('Non ho riconosciuto campi da compilare. Prova con frasi come “Allergie: nichel. Sonno: 7 ore.”')
        else setStatus('Batch analizzato: nessun nuovo campo riconosciuto. Puoi modificare il testo o continuare.')
        return
      }
      setAnalysis(result)
      setReviewSource({ transcript: text, current: { ...currentRef.current } })
      setDrafts(previous => {
        const next = { ...result.values }
        for (const key of editedFields.current) {
          if (previous[key] !== undefined) next[key] = previous[key]
        }
        return next
      })
      setSelected(new Set(extracted.filter(key => currentRef.current[key] !== result.values[key])))
      setStatus(automatic ? 'Bozza aggiornata da un batch di risultati finali. Verifica i campi.' : 'Bozza pronta per la revisione.')
    } catch (reason) {
      if (request !== analysisRun.current) return
      setError(reason instanceof Error ? reason.message : 'Analisi non riuscita. Modifica il testo e riprova.')
    } finally {
      if (request === analysisRun.current) setBusy(false)
    }
  }

  function updateManualTranscript(value: string) {
    if (listening) stopRecognition()
    editedFields.current.clear()
    commitTranscript(value, false)
  }

  function editDraft(key: keyof Anamnesis, value: string) {
    editedFields.current.add(key)
    setDrafts(previous => ({ ...previous, [key]: value }))
    setSelected(previous => {
      const next = new Set(previous)
      if (value.trim()) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function toggle(key: keyof Anamnesis) {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function apply() {
    if (!analysis || sourceStale || busy || selectedConflicts.length) return
    const values = buildSelectedValues(drafts, selected)
    if (!Object.keys(values).length) return
    onApply(values)
    close()
  }

  return <>
    <button className="button secondary voice-anamnesis-trigger" type="button" onClick={() => setOpen(true)}><Mic size={15} />Detta anamnesi</button>
    {open && <Modal title="Assistente per l’anamnesi" description="Detta localmente o inserisci il colloquio: Vatia prepara una bozza progressiva, tu la revisioni e decidi cosa applicare." onClose={close} wide>
      <div className="voice-privacy"><ShieldCheck size={19} /><div><strong>Elaborazione locale e controllo clinico</strong><p>L’app non salva audio o colloquio e non invia dati al form prima di “Applica”. La dettatura cloud non viene offerta né avviata. L’elaborazione sul dispositivo non dimostra equivalenza qualitativa: verifica sempre.</p></div></div>
      <p className="voice-hint" role="status">{speechCapability.message}</p>
      {speechCapability.canInstall && <button className="button secondary" type="button" disabled={speechBusy} onClick={() => void installSpeechPack()}><Download size={15} />Installa pacchetto italiano locale</button>}
      <p className="voice-hint">{modelCapability.message}</p>
      <div className="voice-transcript-heading"><label htmlFor="anamnesis-transcript">Testo del colloquio · risultati finali o inserimento manuale</label>{listening && <span className="recording-indicator" role="status"><i />Dettatura locale in corso</span>}</div>
      <textarea id="anamnesis-transcript" className="voice-transcript" rows={7} value={transcript} onChange={event => updateManualTranscript(event.target.value)} placeholder="Es. Patologie: ipotiroidismo. Farmaci: levotiroxina 50 mcg. Allergie: nichel. Alimentazione vegetariana. Pasti fuori casa: 3. Acqua: 1,5 litri al giorno. Sonno: 7 ore. Stress: alto…" />
      {interim && <p className="voice-hint" role="status">Risultato parziale, non analizzato: “{interim}”</p>}
      <p className="voice-hint">La bozza progressiva usa batch dopo una breve pausa e soltanto risultati finali, mai i parziali. Può quindi ritardare o essere incompleta: la revisione esplicita resta necessaria. Con Regole locali, “Campo: valore” migliora la precisione.</p>
      <div className="voice-controls">
        <button className={`button secondary ${listening ? 'recording' : ''}`} type="button" disabled={speechBusy || (!listening && !speechCapability.canStart)} onClick={() => listening ? stopRecognition() : void startListening()}>{speechBusy ? <LoaderCircle size={15} className="spin" /> : listening ? <Square size={14} /> : speechCapability.canStart ? <Mic size={15} /> : <MicOff size={15} />}{speechBusy ? 'Verifica in corso…' : listening ? 'Interrompi dettatura' : speechCapability.canStart ? 'Avvia dettatura locale' : 'Dettatura locale non pronta'}</button>
        <button className="button primary" type="button" disabled={busy || transcript.trim().length < 3} onClick={() => void runAnalysis(transcriptRef.current)}>{busy ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} />}{busy ? 'Analisi in corso…' : 'Analizza il testo finale'}</button>
      </div>
      {status && <p className="voice-feedback notice" role="status">{status}</p>}
      {error && <p className="voice-feedback error" role="alert">{error}</p>}
      {analysis && <section className="voice-review">
        <div className="voice-review-heading"><div><span className="eyebrow">BOZZA · {analysis.engine.toUpperCase()}</span><h3>Modifica e scegli i campi da applicare</h3></div><span className="badge neutral">{entries.length} riconosciuti</span></div>
        {analysis.notice && <p className="voice-feedback notice">{analysis.notice}</p>}
        {sourceStale && <p className="voice-feedback error" role="alert">Il testo è cambiato dopo questa estrazione. La bozza è obsoleta: rianalizza prima di applicare; nessun valore verrà sovrascritto automaticamente.</p>}
        {conflicts.length > 0 && <p className="voice-feedback error" role="alert">Il form è cambiato dopo la preparazione della bozza ({conflicts.map(key => labels[key]).join(', ')}). Deseleziona i campi in conflitto o rianalizza per aggiornare il riferimento.</p>}
        <div className="voice-field-list">{entries.map(key => {
          const value = drafts[key] ?? ''
          return <div key={key} className={selected.has(key) ? 'selected' : ''}>
            <label><input type="checkbox" checked={selected.has(key)} disabled={!value.trim()} onChange={() => toggle(key)} /><span><strong>{labels[key]}</strong>{current[key] && current[key] !== value && <small>Sostituirà: {current[key]}</small>}{current[key] === value && <small>Coincide con il valore già presente</small>}</span>{selected.has(key) && <Check size={16} />}</label>
            <input aria-label={`Bozza ${labels[key]}`} value={value} onChange={event => editDraft(key, event.target.value)} />
            {analysis.evidence[key] && <small>Evidenza dal testo: “{analysis.evidence[key]}”{editedFields.current.has(key) ? ' · valore modificato manualmente' : ''}</small>}
          </div>
        })}</div>
        <div className="voice-review-footer"><span>Solo i campi selezionati passano al form; il salvataggio resta esterno.</span><button className="button primary" type="button" disabled={!selected.size || sourceStale || busy || selectedConflicts.length > 0} onClick={apply}><Sparkles size={15} />Applica {selected.size} {selected.size === 1 ? 'campo' : 'campi'}</button></div>
      </section>}
    </Modal>}
  </>
}
