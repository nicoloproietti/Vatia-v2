import type { BillingSettings } from '../types'

export type OnboardingStepId = 'studio' | 'office' | 'services' | 'calendar' | 'patient' | 'diet' | 'invite'
export type OnboardingStep = {
  id: OnboardingStepId
  title: string
  description: string
  actionLabel: string
  done: boolean
}
export type OnboardingState = {
  cloud: boolean
  billingSettings: BillingSettings
  officeCount: number
  serviceCount: number
  calendarConnected: boolean
  patientCount: number
  dietCount: number
  inviteCount: number
}

export function buildOnboardingChecklist(state: OnboardingState): OnboardingStep[] {
  const studioReady = [state.billingSettings.studioName, state.billingSettings.professionalName, state.billingSettings.taxCode, state.billingSettings.address, state.billingSettings.city, state.billingSettings.postalCode, state.billingSettings.province].every(value => value.trim())
  const steps: (OnboardingStep & { cloudOnly?: boolean })[] = [
    { id: 'studio', title: 'Presenta il tuo studio', description: 'Dati del professionista pronti per documenti e comunicazioni.', actionLabel: 'Completa dati studio', done: studioReady },
    { id: 'office', title: 'Configura la prima sede', description: 'Orari e sede alimentano agenda e appuntamenti.', actionLabel: 'Aggiungi sede', done: state.officeCount > 0 },
    { id: 'services', title: 'Imposta il tariffario', description: 'Prestazioni, durata e prezzi saranno riutilizzati ovunque.', actionLabel: 'Crea tariffario', done: state.serviceCount > 0 },
    { id: 'calendar', title: 'Collega Google Calendar', description: 'Sincronizza le visite con il tuo account Google, in entrambe le direzioni.', actionLabel: 'Gestisci collegamento', done: state.calendarConnected, cloudOnly: true },
    { id: 'patient', title: 'Aggiungi i tuoi pazienti', description: 'Crea una cartella oppure importa un CSV già esistente.', actionLabel: 'Nuovo paziente', done: state.patientCount > 0 },
    { id: 'diet', title: 'Costruisci la prima dieta', description: 'Il builder riparte da fabbisogno, preferenze e obiettivi del paziente.', actionLabel: 'Apri builder', done: state.dietCount > 0 },
    { id: 'invite', title: 'Attiva l’area paziente', description: 'Invia un magic link e verifica lo stato dalla cartella.', actionLabel: 'Gestisci invito', done: state.inviteCount > 0, cloudOnly: true },
  ]
  return steps.filter(step => state.cloud || !step.cloudOnly)
}

export const onboardingStorageKey = (owner: string) => `vatia-onboarding-dismissed-${owner}`

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function readOnboardingDismissed(owner: string, storage: StorageReader) {
  return storage.getItem(onboardingStorageKey(owner)) === 'true'
}

export function persistOnboardingDismissed(owner: string, storage: StorageWriter) {
  storage.setItem(onboardingStorageKey(owner), 'true')
}
