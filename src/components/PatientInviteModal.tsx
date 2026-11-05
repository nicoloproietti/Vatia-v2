import { useState } from 'react'
import { CheckCircle2, Eye, LoaderCircle, Mail, Send, ShieldCheck } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import type { Patient } from '../types'
import { Modal } from './UI'

export default function PatientInviteModal({ workspace, patient, cloud, onClose, onPreview }: { workspace: Workspace; patient: Patient; cloud: boolean; onClose: () => void; onPreview: () => void }) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function invite() {
    if (!patient.email) return
    setBusy(true); setError('')
    try {
      await workspace.invitePatient(patient.id)
      setSent(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invito non riuscito. Riprova.')
    } finally { setBusy(false) }
  }

  return <Modal title={`Area paziente · ${patient.name}`} description="Un accesso personale per consultare il piano e registrare i pasti, senza strumenti dello studio." onClose={onClose}>
    <div className="invite-explainer"><ShieldCheck size={21} /><div><strong>Solo il suo percorso</strong><p>Il paziente vede esclusivamente il proprio piano pronto, i propri appuntamenti e il proprio diario. Non può modificare la prescrizione.</p></div></div>
    {cloud ? <>
      <div className="invite-recipient"><Mail size={17} /><div><span>Magic link riservato</span><strong>{patient.email || 'Email mancante'}</strong></div></div>
      <p className="muted-block">Vatia collegherà il primo accesso a questa scheda. Se l’email cambia, il collegamento precedente viene revocato.</p>
      {!patient.email && <p className="voice-feedback error" role="alert">Aggiungi prima un’email nel profilo del paziente.</p>}
      {error && <p className="voice-feedback error" role="alert">{error}</p>}
      {sent ? <div className="invite-success" role="status"><CheckCircle2 size={22} /><div><strong>Invito inviato</strong><p>Il paziente deve aprire il link ricevuto via email. Al primo accesso troverà la sua area.</p></div></div> : <button className="button primary full" disabled={!patient.email || busy} onClick={() => void invite()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{busy ? 'Invio in corso…' : 'Invia accesso via email'}</button>}
    </> : <>
      <p className="muted-block">Nell’area ospite puoi provare il portale con dati locali. Con un account cloud, questo stesso pulsante invierà un magic link all’email del paziente.</p>
      <button className="button primary full" onClick={onPreview}><Eye size={16} />Apri anteprima area paziente</button>
    </>}
  </Modal>
}
