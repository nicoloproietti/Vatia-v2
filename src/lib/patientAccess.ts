import type { SupabaseClient } from '@supabase/supabase-js'
import type { Patient, PatientInvite } from '../types'

export async function sendPatientInvite(client: SupabaseClient, patient: Pick<Patient, 'id' | 'email'>, redirectTo: string, onLinked: (invite: PatientInvite) => void) {
  const { error: linkError } = await client.rpc('invite_patient_access', { target_patient: patient.id, target_email: patient.email })
  if (linkError) throw new Error(`Area paziente non configurata o invito non consentito: ${linkError.message}`)
  const { data: access, error: accessError } = await client
    .from('patient_access')
    .select('patient_id,email,user_id,invited_at,claimed_at')
    .eq('patient_id', patient.id)
    .single()
  if (accessError) throw new Error(`Autorizzazione aggiornata, ma stato non verificabile. Non è stata inviata una nuova email: ${accessError.message}`)
  const invite: PatientInvite = {
    patientId: String(access.patient_id), email: String(access.email), userId: access.user_id ? String(access.user_id) : null,
    invitedAt: String(access.invited_at), claimedAt: access.claimed_at ? String(access.claimed_at) : null,
  }
  onLinked(invite)
  const { error: emailError } = await client.auth.signInWithOtp({ email: patient.email, options: { emailRedirectTo: redirectTo } })
  if (emailError) throw new Error(`Autorizzazione aggiornata, ma invio email non riuscito: ${emailError.message}. Puoi riprovare con “Reinvia magic link”.`)
  return invite
}

export async function revokePatientPortalAccess(client: SupabaseClient, patientId: string) {
  const { error } = await client.from('patient_access').delete().eq('patient_id', patientId)
  if (error) throw error
}
