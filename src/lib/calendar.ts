import type { Appointment } from '../types'

export type CalendarEventInput = {
  appointment: Appointment
  patientName?: string
  location?: string
  includeNotes?: boolean
}

type GoogleToken = { access_token: string; expires_in?: number }
type GoogleTokenClient = {
  callback: (response: GoogleToken & { error?: string; error_description?: string }) => void
  error_callback: (error: { type?: string }) => void
  requestAccessToken: (options?: { prompt?: string }) => void
}
type GoogleAccounts = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: GoogleTokenClient['callback']
        error_callback: GoogleTokenClient['error_callback']
      }) => GoogleTokenClient
    }
  }
}

declare global {
  interface Window { google?: GoogleAccounts }
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
let gisPromise: Promise<void> | null = null
let accessToken = ''
let tokenExpiresAt = 0

export const googleCalendarConfigured = () => Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim())

function eventSummary({ appointment, patientName }: CalendarEventInput) {
  return `${appointment.visitType}${patientName ? ` · ${patientName}` : ''}`
}

function validDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Data dell’appuntamento non valida.')
  return date
}

function icsDate(value: string) {
  return validDate(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
}

function foldIcsLine(line: string) {
  const encoder = new TextEncoder()
  let output = ''
  let current = ''
  for (const character of line) {
    if (current && encoder.encode(current + character).length > 73) {
      output += `${current}\r\n `
      current = character
    } else current += character
  }
  return output + current
}

export function appointmentIcs(input: CalendarEventInput) {
  const { appointment } = input
  const description = ['Appuntamento gestito con Vatia.', input.includeNotes ? appointment.notes : ''].filter(Boolean).join('\n\n')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vatia//Agenda Studio//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:vatia-${appointment.id || 'bozza'}@vatia.app`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(appointment.startsAt)}`,
    `DTEND:${icsDate(appointment.endsAt)}`,
    `SUMMARY:${escapeIcs(eventSummary(input))}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    input.location ? `LOCATION:${escapeIcs(input.location)}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

export function downloadAppointmentIcs(input: CalendarEventInput) {
  const blob = new Blob([appointmentIcs(input)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `visita-${input.appointment.startsAt.slice(0, 10)}.ics`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function loadGoogleIdentity() {
  if (window.google?.accounts.oauth2) return Promise.resolve()
  if (gisPromise) return gisPromise
  gisPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('vatia-google-identity') as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')
    const timeout = window.setTimeout(() => reject(new Error('Google Identity Services non risponde. Verifica la connessione e riprova.')), 15000)
    script.id = 'vatia-google-identity'
    script.async = true
    script.defer = true
    script.src = 'https://accounts.google.com/gsi/client'
    script.onload = () => { window.clearTimeout(timeout); resolve() }
    script.onerror = () => { window.clearTimeout(timeout); gisPromise = null; reject(new Error('Impossibile caricare Google Identity Services.')) }
    if (!existing) document.head.appendChild(script)
  })
  return gisPromise
}

async function googleAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
  if (!clientId) throw new Error('Configura VITE_GOOGLE_CLIENT_ID per abilitare la sincronizzazione Google Calendar.')
  await loadGoogleIdentity()
  if (!window.google) throw new Error('Google Identity Services non è disponibile.')
  const token = await new Promise<GoogleToken>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPE,
      callback: response => {
        if (response.error || !response.access_token) reject(new Error(response.error_description || 'Autorizzazione Google non completata.'))
        else resolve(response)
      },
      error_callback: error => reject(new Error(error.type === 'popup_closed' ? 'Finestra Google chiusa prima del completamento.' : 'Accesso a Google Calendar non autorizzato.')),
    })
    client.requestAccessToken({ prompt: accessToken ? '' : 'consent' })
  })
  accessToken = token.access_token
  tokenExpiresAt = Date.now() + (token.expires_in ?? 3600) * 1000
  return accessToken
}

async function calendarFetch(url: string, init: RequestInit = {}) {
  const token = await googleAccessToken()
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (response.status === 401) {
    accessToken = ''
    tokenExpiresAt = 0
    throw new Error('La sessione Google è scaduta. Riprova la sincronizzazione.')
  }
  if (!response.ok) throw new Error(`Google Calendar ha risposto con errore ${response.status}. Verifica autorizzazioni e configurazione OAuth.`)
  return response.status === 204 ? null : response.json() as Promise<{ id?: string; items?: { id: string }[] }>
}

export async function syncAppointmentToGoogle(input: CalendarEventInput): Promise<'created' | 'updated'> {
  const { appointment } = input
  if (!appointment.id) throw new Error('Salva prima l’appuntamento, poi sincronizzalo con Google Calendar.')
  validDate(appointment.startsAt)
  validDate(appointment.endsAt)
  const query = new URLSearchParams({ privateExtendedProperty: `vatiaAppointmentId=${appointment.id}`, maxResults: '1' })
  const existing = await calendarFetch(`${GOOGLE_API}?${query}`)
  const eventId = existing?.items?.[0]?.id
  const description = ['Appuntamento gestito con Vatia.', input.includeNotes ? appointment.notes : ''].filter(Boolean).join('\n\n')
  const body = JSON.stringify({
    summary: eventSummary(input),
    description,
    location: input.location || '',
    start: { dateTime: validDate(appointment.startsAt).toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome' },
    end: { dateTime: validDate(appointment.endsAt).toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome' },
    extendedProperties: { private: { vatiaAppointmentId: appointment.id } },
  })
  await calendarFetch(eventId ? `${GOOGLE_API}/${encodeURIComponent(eventId)}` : GOOGLE_API, { method: eventId ? 'PATCH' : 'POST', body })
  return eventId ? 'updated' : 'created'
}
