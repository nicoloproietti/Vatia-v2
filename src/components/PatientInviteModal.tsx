import { useState } from 'react'
import { CheckCircle2, Eye, LoaderCircle, Mail, Send, ShieldCheck, Trash2 } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import { formatDateTime } from '../lib/clinical'
import type { Patient } from '../types'
import { Modal } from './UI'

export default function PatientInviteModal({ workspace, patient, cloud, onClose, onPreview }: { workspace: Workspace; patient: Patient; cloud: boolean; onClose: () => void; onPreview: () => void }) {
  const [busy, setBusy] = useState<'invite' | 'revoke' | ''>('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const invite = workspace.patientInvites.find(item => item.patientId === patient.id)
  const active = Boolean(invite?.claimedAt)

  async function sendInvite() {
    if (!patient.email) return
    setBusy('invite'); setError(''); setSent(false)
    try {
      await workspace.invitePatient(patient.id)
      setSent(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invito non riuscito. Riprova.')
    } finally { setBusy('') }
  }

  async function revoke() {
    setBusy('revoke'); setError('')
    try {
      await workspace.revokePatientAccess(patient.id)
      setConfirmRevoke(false); setSent(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Revoca non riuscita. Riprova.')
    } finally { setBusy('') }
  }

  return <Modal title={`Area paziente · ${patient.name}`} description="Un accesso personale per consultare il piano e registrare i pasti, senza strumenti dello studio." onClose={onClose}>
    <div className="invite-explainer"><ShieldCheck size={21} /><div><strong>Solo il suo percorso</strong><p>Il paziente vede esclusivamente il proprio piano pronto, i propri appuntamenti e il proprio diario. Non può modificare la prescrizione.</p></div></div>
    {cloud ? <>
      <div className="invite-status-row">
        <span className={`badge ${active ? 'success' : invite ? 'warning' : 'neutral'}`}>{active ? 'Portale attivo' : invite ? 'Invito in sospeso' : 'Portale non attivo'}</span>
        {invite?.claimedAt && <span>Attivato {formatDateTime(invite.claimedAt)}</span>}
      </div>
      <div className="invite-recipient"><Mail size={17} /><div><span>Magic link riservato</span><strong>{patient.email || 'Email mancante'}</strong>{invite && <small>Invito aggiornato {formatDateTime(invite.invitedAt)}{invite.email.toLowerCase() !== patient.email.toLowerCase() ? ` · accesso precedente: ${invite.email}` : ''}</small>}</div></div>
      <p className="muted-block">Vatia collegherà il primo accesso a questa scheda. Se l’email cambia, il collegamento precedente viene sostituito al prossimo invio.</p>
      {workspace.inviteWarning && <p className="voice-feedback error" role="alert">{workspace.inviteWarning}</p>}
      {!patient.email && <p className="voice-feedback error" role="alert">Aggiungi prima un’email nel profilo del paziente.</p>}
      {error && <p className="voice-feedback error" role="alert">{error}</p>}
      {sent && <div className="invite-success" role="status"><CheckCircle2 size={22} /><div><strong>Magic link inviato</strong><p>Il paziente deve aprire il link ricevuto via email. Al primo accesso troverà la sua area.</p></div></div>}
      <button className="button primary full" disabled={!patient.email || Boolean(busy)} onClick={() => void sendInvite()}>{busy === 'invite' ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{busy === 'invite' ? 'Invio in corso…' : invite ? 'Reinvia magic link' : 'Invia accesso via email'}</button>
      {invite && <div className="invite-revoke-area">
        {!confirmRevoke ? <button className="text-button danger-text" disabled={Boolean(busy)} onClick={() => { setConfirmRevoke(true); setError('') }}><Trash2 size={14} />Revoca accesso</button> : <div className="invite-revoke-confirm" role="alertdialog" aria-label="Conferma revoca accesso"><strong>Revocare l’accesso al portale?</strong><p>Vengono rimosse soltanto le autorizzazioni cloud. Paziente, diete, diario e dati clinici restano invariati.</p><div><button className="button secondary" disabled={Boolean(busy)} onClick={() => setConfirmRevoke(false)}>Annulla</button><button className="button danger" disabled={Boolean(busy)} onClick={() => void revoke()}>{busy === 'revoke' ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}{busy === 'revoke' ? 'Revoca…' : 'Conferma revoca'}</button></div></div>}
      </div>}
    </> : <>
      <p className="muted-block">Nell’area ospite puoi provare il portale con dati locali. Con un account cloud, questo stesso pulsante invierà un magic link all’email del paziente.</p>
      <button className="button primary full" onClick={onPreview}><Eye size={16} />Apri anteprima area paziente</button>
    </>}
  </Modal>
}
