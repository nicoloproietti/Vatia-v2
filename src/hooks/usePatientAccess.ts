import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type PatientAccess = { loading: boolean; patientId: string | null }

/** Risolve il ruolo senza esporre l’area professionale durante il controllo. */
export function usePatientAccess(session: Session | null): PatientAccess {
  const [access, setAccess] = useState<PatientAccess>({ loading: Boolean(supabase && session), patientId: null })

  useEffect(() => {
    let active = true
    if (!supabase || !session) {
      queueMicrotask(() => { if (active) setAccess({ loading: false, patientId: null }) })
      return () => { active = false }
    }
    queueMicrotask(() => { if (active) setAccess({ loading: true, patientId: null }) })
    void (async () => {
      // Prima della migrazione la funzione non esiste: gli account professionali continuano a funzionare.
      await supabase.rpc('claim_patient_access')
      const { data, error } = await supabase.from('patient_access').select('patient_id').eq('user_id', session.user.id).maybeSingle()
      if (!active) return
      setAccess({ loading: false, patientId: error ? null : data?.patient_id ?? null })
    })()
    return () => { active = false }
  }, [session])

  return access
}
