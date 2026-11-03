import { useEffect, useMemo, useState } from 'react'
import { Camera, Check, FileImage, Image, LoaderCircle, Plus, ScanLine, Search, ShieldCheck, Sparkles } from 'lucide-react'
import type { Food } from '../types'
import { inspectLocalFoodVision, matchFoodCandidates, readNutritionLabel, recognizeFoodPhoto, type LabelScan } from '../lib/foodScanner'
import { EmptyState, Modal } from './UI'

type Props = {
  foods: Food[]
  onClose: () => void
  onLabelDraft: (draft: Partial<Food>) => void
  onPhotoDraft: (draft: Partial<Food>) => void
  onIdentified: (food: Food) => void
}

export default function FoodScanner({ foods, onClose, onLabelDraft, onPhotoDraft, onIdentified }: Props) {
  const [mode, setMode] = useState<'label' | 'photo'>('label')
  return <Modal title="Scansiona alimento" description="Etichetta e foto usano percorsi distinti: Vatia propone una bozza, tu confermi ogni dato." onClose={onClose} wide>
    <div className="scanner-privacy"><ShieldCheck size={18} /><p><strong>Elaborazione sul dispositivo</strong> · Le immagini non vengono inviate a servizi cloud. Le capacità AI dipendono dal browser; la verifica umana resta obbligatoria.</p></div>
    <div className="record-tabs scanner-tabs"><button className={mode === 'label' ? 'active' : ''} onClick={() => setMode('label')}><ScanLine size={15} />Etichetta nutrizionale</button><button className={mode === 'photo' ? 'active' : ''} onClick={() => setMode('photo')}><Camera size={15} />Foto dell’alimento</button></div>
    {mode === 'label' ? <LabelScanner onDraft={onLabelDraft} /> : <PhotoScanner foods={foods} onPhotoDraft={onPhotoDraft} onIdentified={onIdentified} />}
  </Modal>
}

function ImagePicker({ id, file, onChange }: { id: string; file: File | null; onChange: (file: File | null) => void }) {
  const preview = useMemo(() => file ? URL.createObjectURL(file) : '', [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  return <div className="scanner-image-picker">
    {preview ? <img src={preview} alt="Immagine acquisita da revisionare" /> : <div className="scanner-image-empty"><Image size={30} /><strong>Nessuna immagine</strong><span>Scegli una foto nitida e ben illuminata.</span></div>}
    <label className="button secondary" htmlFor={id}><FileImage size={16} />{file ? 'Cambia immagine' : 'Scegli o scatta una foto'}</label>
    <input id={id} type="file" accept="image/*" capture="environment" onChange={event => onChange(event.target.files?.[0] ?? null)} />
  </div>
}

function LabelScanner({ onDraft }: { onDraft: (draft: Partial<Food>) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [scan, setScan] = useState<LabelScan | null>(null)
  const [sourceRevision, setSourceRevision] = useState(0)

  function changeFile(next: File | null) {
    setFile(next); setScan(null); setError(''); setStatus(''); setSourceRevision(value => value + 1)
  }
  async function scanLabel() {
    if (!file) return
    const revision = sourceRevision
    setBusy(true); setError(''); setScan(null)
    try {
      const result = await readNutritionLabel(file, message => { if (revision === sourceRevision) setStatus(message) })
      if (revision !== sourceRevision) return
      setScan(result)
      setStatus(result.text.trim() ? 'OCR completato. Controlla il testo e i valori prima di creare la bozza.' : 'Nessun testo rilevato.')
      if (!result.text.trim()) setError('Non ho letto testo dall’immagine. Prova una foto più nitida oppure inserisci l’alimento manualmente.')
    } catch (reason) {
      if (revision === sourceRevision) setError(reason instanceof Error ? reason.message : 'OCR locale non riuscito. Puoi inserire l’alimento manualmente.')
    } finally {
      if (revision === sourceRevision) setBusy(false)
    }
  }
  function review() {
    if (!scan) return
    onDraft({
      name: '', category: 'altro', meals: 'all', source: 'Etichetta nutrizionale · OCR locale',
      note: `${scan.basis === '100_g' ? 'Valori per 100 g' : scan.basis === '100_ml' ? 'Valori per 100 ml' : scan.basis === 'portion' ? 'Base porzione da verificare' : 'Base nutrizionale da verificare'}${scan.kcalOrigin === 'calculated' ? ' · kcal derivate da kJ' : ''}`,
      per100g: { kcal: scan.values.kcal ?? 0, protein: scan.values.protein ?? 0, carbs: scan.values.carbs ?? 0, fat: scan.values.fat ?? 0, fiber: scan.values.fiber ?? 0 },
    })
  }
  return <div className="scanner-layout">
    <div><ImagePicker id="label-photo" file={file} onChange={changeFile} /><button className="button primary full" disabled={!file || busy} onClick={() => void scanLabel()}>{busy ? <LoaderCircle className="spin" size={16} /> : <ScanLine size={16} />}{busy ? 'Lettura in corso…' : 'Leggi etichetta sul dispositivo'}</button></div>
    <div className="scanner-results">
      {status && <p className="voice-feedback notice" role="status">{status}</p>}
      {error && <p className="voice-feedback error" role="alert">{error}</p>}
      {!scan && !busy && <EmptyState icon={<ScanLine size={27} />} title="Nessun dato estratto" text="L’OCR legge il testo; i valori diventano una bozza soltanto dopo il tuo controllo." />}
      {scan && <>
        <div className="scan-basis"><span>Base rilevata</span><strong>{{ '100_g': '100 g', '100_ml': '100 ml', portion: 'Porzione · da verificare', unknown: 'Non riconosciuta' }[scan.basis]}</strong></div>
        {scan.warnings.map(warning => <p className="scan-warning" key={warning}>{warning}</p>)}
        <div className="scan-nutrients">{(['kcal', 'protein', 'carbs', 'fat', 'fiber'] as const).map(key => <div key={key}><span>{{ kcal: 'Energia', protein: 'Proteine', carbs: 'Carboidrati', fat: 'Grassi', fiber: 'Fibre' }[key]}</span><strong>{scan.values[key] == null ? 'Non letto' : `${scan.values[key]} ${key === 'kcal' ? 'kcal' : 'g'}`}</strong></div>)}</div>
        <details className="ocr-details"><summary>Mostra il testo OCR da verificare</summary><pre>{scan.text || 'Nessun testo'}</pre></details>
        <button className="button primary full" onClick={review}><Check size={16} />Revisiona e completa la bozza</button>
      </>}
    </div>
  </div>
}

function PhotoScanner({ foods, onPhotoDraft, onIdentified }: { foods: Food[]; onPhotoDraft: (draft: Partial<Food>) => void; onIdentified: (food: Food) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [capability, setCapability] = useState({ available: false, message: 'Verifica del modello visivo locale…' })
  const [label, setLabel] = useState('')
  const [uncertain, setUncertain] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Food | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { void inspectLocalFoodVision().then(setCapability) }, [])
  const candidates = label ? matchFoodCandidates(label, foods) : []
  const manual = foods.filter(food => !food.isLegacy && food.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
  const shown = search.trim() ? manual : candidates
  const unmatchedName = (search.trim() || label).trim()
  const baseQuery = /^(?:french fries|fries|patate fritte)$/i.test(label.trim()) ? 'patata' : null
  const showingBase = Boolean(baseQuery && search.trim().toLowerCase() === baseQuery)

  function createPersonal() {
    if (!unmatchedName) return
    onPhotoDraft({
      name: unmatchedName, category: 'altro', meals: 'all', processingState: 'unspecified',
      source: label && !search.trim() ? 'Foto · riconoscimento locale' : 'Alimento personale',
      note: 'Voce assente dal catalogo CIQUAL. Inserisci valori da una fonte verificata: nessuna equivalenza con ingredienti crudi è stata applicata.',
    })
  }

  async function recognize() {
    if (!file) return
    setBusy(true); setError(''); setLabel(''); setSelected(null); setSearch('')
    try {
      const result = await recognizeFoodPhoto(file)
      setLabel(result.label ?? '')
      setUncertain(result.uncertain || !result.label)
      if (!result.label) setError('Non ho riconosciuto un solo alimento con sufficiente chiarezza. Cerca e seleziona manualmente la voce corretta.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Riconoscimento locale non riuscito. Usa la ricerca manuale.')
    } finally { setBusy(false) }
  }
  return <div className="scanner-layout">
    <div><ImagePicker id="food-photo" file={file} onChange={next => { setFile(next); setLabel(''); setSelected(null); setSearch(''); setError('') }} /><button className="button primary full" disabled={!file || busy || !capability.available} onClick={() => void recognize()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{busy ? 'Analisi locale…' : 'Proponi l’alimento'}</button><p className="voice-hint">{capability.message}</p></div>
    <div className="scanner-results">
      <div className="scanner-no-estimates"><strong>Nessuna stima da pixel</strong><span>Peso e kcal della porzione non vengono dedotti dalla foto. Le kcal/100 g arrivano solo dalla voce CIQUAL confermata.</span></div>
      {label && <p className="voice-feedback notice">Suggerimento visivo: <strong>{label}</strong>{uncertain ? ' · incerto, richiede conferma' : ''}</p>}
      {error && <p className="voice-feedback error" role="alert">{error}</p>}
      <div className="search-field"><Search size={17} /><input value={search} onChange={event => { setSearch(event.target.value); setSelected(null) }} placeholder="Conferma o cerca manualmente…" aria-label="Cerca alimento riconosciuto" /></div>
      <div className="scanner-food-candidates">{shown.map(food => <button className={selected?.id === food.id ? 'selected' : ''} key={food.id} onClick={() => setSelected(food)}><span><strong>{food.name}</strong><small>{food.note} · {food.source}</small></span><b>{food.per100g.kcal} kcal / 100 g</b></button>)}</div>
      {showingBase && <p className="scanner-base-warning" role="note"><strong>Ingrediente base, non equivalente.</strong> I valori della patata non sono quelli di “{label}”. Per registrare l’alimento riconosciuto, cancella la ricerca e crea una voce personale con una fonte verificata.</p>}
      {!shown.length && unmatchedName && <div className="scanner-unmatched"><EmptyState icon={<Search size={25} />} title={`“${unmatchedName}” non è nel catalogo`} text="Nessun valore viene inventato o copiato da un ingrediente crudo. Puoi creare una voce personale oppure cercare manualmente un ingrediente base." /><div className="scanner-unmatched-actions"><button className="button secondary" onClick={createPersonal}><Plus size={16} />Crea “{unmatchedName}” come personale</button>{baseQuery && <button className="button secondary" onClick={() => { setSearch(baseQuery); setSelected(null) }}><Search size={16} />Cerca patata · non equivalente</button>}</div></div>}
      <button className="button primary full" disabled={!selected} onClick={() => selected && onIdentified(selected)}><Check size={16} />Conferma e mostra nel database</button>
    </div>
  </div>
}
