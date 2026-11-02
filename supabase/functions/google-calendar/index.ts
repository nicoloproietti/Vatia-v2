// Vatia Google Calendar account connector.
// Deploy with JWT verification disabled at the gateway: this function verifies
// user JWTs itself and uses a separate secret for the scheduled sync_all action.

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Promise<Response>): void
}

type JsonObject = Record<string, unknown>
type Connection = {
  user_id: string
  google_email: string
  refresh_token_encrypted: string
  access_token_encrypted: string | null
  access_token_expires_at: string | null
  last_sync_at: string | null
}
type Appointment = {
  id: string
  user_id: string
  patient_id: string | null
  office_id: string | null
  google_event_id: string | null
  starts_at: string
  ends_at: string
  visit_type: string
  notes: string | null
  google_updated_at: string | null
  last_synced_at: string | null
  google_include_notes: boolean
  google_include_location: boolean
  created_at: string
  updated_at: string | null
}
type Patient = { id: string; name: string }
type Office = { id: string; name: string; address: string | null; city: string | null; postal_code: string | null; province: string | null }
type GoogleEvent = {
  id: string
  summary?: string
  status?: string
  updated?: string
  location?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  extendedProperties?: { private?: Record<string, string> }
}
type SyncStats = {
  imported: number
  updated: number
  deleted: number
  pushed: number
  changes: number
  errors: number
  lastSyncAt: string
}

const GOOGLE_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const DEFAULT_ORIGINS = 'http://localhost:7100,http://127.0.0.1:7100,https://nicoloproietti.github.io'

class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

function env(name: string, required = true) {
  const value = Deno.env.get(name)?.trim() ?? ''
  if (required && !value) throw new HttpError(503, `Configurazione server incompleta: ${name}.`)
  return value
}

function corsOrigin(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  const allowed = (env('ALLOWED_ORIGINS', false) || DEFAULT_ORIGINS).split(',').map(value => value.trim())
  return allowed.includes(origin) ? origin : allowed[0]
}

function json(request: Request, data: JsonObject, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': corsOrigin(request),
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-vatia-cron-key',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    },
  })
}

async function bodyOf(request: Request) {
  try { return await request.json() as JsonObject } catch { return {} }
}

async function verifyUser(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Sessione Vatia non valida o scaduta.')
  const response = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_ANON_KEY', false) || env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: authorization },
  })
  if (!response.ok) throw new HttpError(401, 'Sessione Vatia non valida o scaduta.')
  const user = await response.json() as { id?: string }
  if (!user.id) throw new HttpError(401, 'Utente Vatia non riconosciuto.')
  return user.id
}

async function database<T>(path: string, init: RequestInit = {}): Promise<T> {
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!response.ok) {
    const detail = await response.text()
    console.error('Database request failed', response.status, detail.slice(0, 500))
    throw new HttpError(502, 'Il database Vatia non ha completato l’operazione.')
  }
  if (response.status === 204) return null as T
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

async function encryptionKey() {
  const bytes = decodeBase64(env('GOOGLE_TOKEN_ENCRYPTION_KEY'))
  if (bytes.length !== 32) throw new HttpError(503, 'La chiave di cifratura Google deve contenere 32 byte.')
  return crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptToken(value: string, userId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`vatia-google:${userId}`) },
    await encryptionKey(),
    new TextEncoder().encode(value),
  )
  return `v1.${encodeBase64(iv)}.${encodeBase64(new Uint8Array(encrypted))}`
}

async function decryptToken(value: string, userId: string) {
  const [version, iv, payload] = value.split('.')
  if (version !== 'v1' || !iv || !payload) throw new HttpError(500, 'Token Google cifrato in un formato non valido.')
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(iv) as BufferSource, additionalData: new TextEncoder().encode(`vatia-google:${userId}`) },
    await encryptionKey(),
    decodeBase64(payload) as BufferSource,
  )
  return new TextDecoder().decode(decrypted)
}

async function googleTokenResponse(body: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
  if (!response.ok || !result.access_token) {
    if (result.error === 'invalid_grant') throw new HttpError(401, 'Google ha revocato o rifiutato il collegamento. Collega di nuovo l’account.', 'reconnect_required')
    throw new HttpError(400, 'Google non ha completato l’autorizzazione. Riprova dal tuo account Vatia.')
  }
  return result
}

async function connectionFor(userId: string) {
  const rows = await database<Connection[]>(`calendar_connections?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`)
  return rows[0] ?? null
}

async function requireConnection(userId: string) {
  const connection = await connectionFor(userId)
  if (!connection) throw new HttpError(409, 'Collega prima il tuo account Google dalla scheda nella barra laterale.', 'not_connected')
  return connection
}

async function validAccessToken(connection: Connection) {
  if (connection.access_token_encrypted && connection.access_token_expires_at && Date.parse(connection.access_token_expires_at) > Date.now() + 60000) {
    return decryptToken(connection.access_token_encrypted, connection.user_id)
  }
  const refreshToken = await decryptToken(connection.refresh_token_encrypted, connection.user_id)
  const token = await googleTokenResponse(new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    client_secret: env('GOOGLE_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }))
  const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString()
  await database(`calendar_connections?user_id=eq.${encodeURIComponent(connection.user_id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      access_token_encrypted: await encryptToken(token.access_token!, connection.user_id),
      access_token_expires_at: expiresAt,
      ...(token.refresh_token ? { refresh_token_encrypted: await encryptToken(token.refresh_token, connection.user_id) } : {}),
      updated_at: new Date().toISOString(),
    }),
  })
  return token.access_token!
}

async function googleRequest<T>(accessToken: string, path: string, init: RequestInit = {}) {
  const response = await fetch(path.startsWith('http') ? path : `${GOOGLE_EVENTS}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!response.ok) {
    if (response.status === 401) throw new HttpError(401, 'La sessione Google non è più valida. Collega di nuovo l’account.', 'reconnect_required')
    if (response.status === 403) throw new HttpError(403, 'Google Calendar non ha concesso l’accesso o ha raggiunto un limite. Riprova tra poco.')
    if (response.status === 404 || response.status === 410) return null
    console.error('Google Calendar request failed', response.status)
    throw new HttpError(502, `Google Calendar ha risposto con errore ${response.status}.`)
  }
  return response.status === 204 ? null : await response.json() as T
}

async function listEvents(accessToken: string, timeMin: string, timeMax: string, showDeleted: boolean) {
  const items: GoogleEvent[] = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', showDeleted: String(showDeleted), maxResults: '250',
      fields: 'nextPageToken,items(id,summary,status,start,end,location,updated,extendedProperties)',
    })
    if (pageToken) query.set('pageToken', pageToken)
    const result = await googleRequest<{ items?: GoogleEvent[]; nextPageToken?: string }>(accessToken, `?${query}`)
    items.push(...(result?.items ?? []))
    pageToken = result?.nextPageToken ?? ''
  } while (pageToken)
  return items
}

function validInterval(startValue: unknown, endValue: unknown) {
  const start = new Date(String(startValue ?? ''))
  const end = new Date(String(endValue ?? ''))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new HttpError(400, 'Intervallo Google Calendar non valido.')
  if (end.getTime() - start.getTime() > 400 * 86400000) throw new HttpError(400, 'L’intervallo richiesto supera i 400 giorni.')
  return { start: start.toISOString(), end: end.toISOString() }
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('it-IT').replace(/\s+/g, ' ')
}

export function visitTypeFromSummary(summary: string | undefined, patientName?: string) {
  let title = summary?.trim() || 'Appuntamento Google'
  if (patientName) {
    const escaped = patientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title.replace(new RegExp(`\\s*[·|–—-]\\s*${escaped}\\s*$`, 'i'), '').trim() || 'Visita'
  }
  return title.slice(0, 300)
}

function officeLocation(office?: Office) {
  return office ? [office.name, office.address, [office.postal_code, office.city, office.province].filter(Boolean).join(' ')].filter(Boolean).join(', ') : ''
}

function eventBody(appointment: Appointment, patient?: Patient, office?: Office, includeNotes?: boolean, includeLocation?: boolean) {
  const notes = includeNotes ?? appointment.google_include_notes
  const location = includeLocation ?? appointment.google_include_location
  return {
    summary: `${appointment.visit_type}${patient ? ` · ${patient.name}` : ''}`,
    description: ['Appuntamento gestito con Vatia.', notes ? appointment.notes ?? '' : ''].filter(Boolean).join('\n\n'),
    location: location ? officeLocation(office) : '',
    start: { dateTime: new Date(appointment.starts_at).toISOString(), timeZone: 'Europe/Rome' },
    end: { dateTime: new Date(appointment.ends_at).toISOString(), timeZone: 'Europe/Rome' },
    extendedProperties: { private: { vatiaAppointmentId: appointment.id } },
  }
}

function emptyStats(): SyncStats {
  return { imported: 0, updated: 0, deleted: 0, pushed: 0, changes: 0, errors: 0, lastSyncAt: new Date().toISOString() }
}

async function deleteLocalAppointment(appointment: Appointment) {
  await database(`appointments?id=eq.${encodeURIComponent(appointment.id)}&user_id=eq.${encodeURIComponent(appointment.user_id)}`, { method: 'DELETE' })
  if (appointment.google_event_id) {
    await database(`calendar_tombstones?user_id=eq.${encodeURIComponent(appointment.user_id)}&google_event_id=eq.${encodeURIComponent(appointment.google_event_id)}`, { method: 'DELETE' })
  }
}

async function pushAppointment(
  accessToken: string,
  appointment: Appointment,
  patient?: Patient,
  office?: Office,
  includeNotes?: boolean,
  includeLocation?: boolean,
) {
  let eventId = appointment.google_event_id ?? ''
  if (!eventId) {
    const query = new URLSearchParams({ privateExtendedProperty: `vatiaAppointmentId=${appointment.id}`, maxResults: '1', fields: 'items(id)' })
    const matches = await googleRequest<{ items?: { id: string }[] }>(accessToken, `?${query}`)
    eventId = matches?.items?.[0]?.id ?? ''
  }
  const payload = eventBody(appointment, patient, office, includeNotes, includeLocation)
  let event = eventId
    ? await googleRequest<GoogleEvent>(accessToken, `/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(payload) })
    : null
  let created = false
  if (!event) {
    event = await googleRequest<GoogleEvent>(accessToken, '', { method: 'POST', body: JSON.stringify(payload) })
    created = true
  }
  if (!event?.id) throw new HttpError(502, 'Google non ha restituito l’identificativo dell’evento.')
  const syncedAt = new Date().toISOString()
  await database(`appointments?id=eq.${encodeURIComponent(appointment.id)}&user_id=eq.${encodeURIComponent(appointment.user_id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      google_event_id: event.id,
      google_updated_at: event.updated ?? syncedAt,
      last_synced_at: syncedAt,
      ...(includeNotes === undefined ? {} : { google_include_notes: includeNotes }),
      ...(includeLocation === undefined ? {} : { google_include_location: includeLocation }),
    }),
  })
  return { event, created, syncedAt }
}

async function pullAppointment(appointment: Appointment, event: GoogleEvent, patient?: Patient) {
  if (!event.start?.dateTime || !event.end?.dateTime || !event.updated) return false
  const syncedAt = new Date().toISOString()
  await database(`appointments?id=eq.${encodeURIComponent(appointment.id)}&user_id=eq.${encodeURIComponent(appointment.user_id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      google_event_id: event.id,
      starts_at: event.start.dateTime,
      ends_at: event.end.dateTime,
      visit_type: visitTypeFromSummary(event.summary, patient?.name),
      google_updated_at: event.updated,
      last_synced_at: syncedAt,
      updated_at: event.updated,
    }),
  })
  return true
}

async function syncConnection(connection: Connection): Promise<SyncStats> {
  const stats = emptyStats()
  const accessToken = await validAccessToken(connection)
  const userId = connection.user_id
  const now = Date.now()
  const timeMin = new Date(now - 30 * 86400000).toISOString()
  const timeMax = new Date(now + 90 * 86400000).toISOString()
  const [appointments, patients, offices, tombstones] = await Promise.all([
    database<Appointment[]>(`appointments?user_id=eq.${encodeURIComponent(userId)}&select=*`),
    database<Patient[]>(`patients?user_id=eq.${encodeURIComponent(userId)}&select=id,name`),
    database<Office[]>(`offices?user_id=eq.${encodeURIComponent(userId)}&select=id,name,address,city,postal_code,province`),
    database<{ id: string; google_event_id: string }[]>(`calendar_tombstones?user_id=eq.${encodeURIComponent(userId)}&select=id,google_event_id`),
  ])
  const patientMap = new Map(patients.map(patient => [patient.id, patient]))
  const officeMap = new Map(offices.map(office => [office.id, office]))

  for (const tombstone of tombstones) {
    try {
      await googleRequest(accessToken, `/${encodeURIComponent(tombstone.google_event_id)}`, { method: 'DELETE' })
      await database(`calendar_tombstones?id=eq.${encodeURIComponent(tombstone.id)}`, { method: 'DELETE' })
      stats.deleted += 1
      stats.changes += 1
    } catch (error) {
      console.error('Tombstone sync failed', userId, error instanceof Error ? error.message : 'unknown')
      stats.errors += 1
    }
  }

  const events = await listEvents(accessToken, timeMin, timeMax, true)
  const byId = new Map(events.map(event => [event.id, event]))
  const byAppointment = new Map<string, GoogleEvent>()
  for (const event of events) {
    const id = event.extendedProperties?.private?.vatiaAppointmentId
    if (id && !byAppointment.has(id)) byAppointment.set(id, event)
  }
  const handledEvents = new Set<string>()
  const inWindow = (appointment: Appointment) => {
    const start = Date.parse(appointment.starts_at)
    return start >= Date.parse(timeMin) && start <= Date.parse(timeMax)
  }

  for (const appointment of appointments) {
    if (!inWindow(appointment)) continue
    try {
      const patient = patientMap.get(appointment.patient_id ?? '')
      const office = officeMap.get(appointment.office_id ?? '')
      const remote = (appointment.google_event_id ? byId.get(appointment.google_event_id) : undefined) ?? byAppointment.get(appointment.id)
      if (remote) handledEvents.add(remote.id)
      if (appointment.google_event_id && (!remote || remote.status === 'cancelled')) {
        await deleteLocalAppointment(appointment)
        stats.deleted += 1
        stats.changes += 1
        continue
      }
      if (!remote) {
        await pushAppointment(accessToken, appointment, patient, office)
        stats.pushed += 1
        stats.changes += 1
        continue
      }
      if (remote.status === 'cancelled' || !remote.start?.dateTime || !remote.end?.dateTime || !remote.updated) continue

      const lastSync = Date.parse(appointment.last_synced_at ?? '')
      const localTime = Date.parse(appointment.updated_at ?? appointment.created_at)
      const remoteTime = Date.parse(remote.updated)
      const localChanged = !Number.isFinite(lastSync) || localTime > lastSync
      const remoteChanged = !Number.isFinite(lastSync) || remoteTime > lastSync
      const needsLink = appointment.google_event_id !== remote.id
      if (!localChanged && !remoteChanged && !needsLink) continue

      // Legacy imports have no reliable sync baseline: adopt Google once rather
      // than overwriting it with the migration's default updated_at timestamp.
      const adoptRemote = !appointment.last_synced_at && !appointment.google_updated_at
      if (!adoptRemote && (localTime > remoteTime || !remoteChanged)) {
        await pushAppointment(accessToken, appointment, patient, office)
        stats.pushed += 1
      } else {
        await pullAppointment(appointment, remote, patient)
        stats.updated += 1
      }
      stats.changes += 1
    } catch (error) {
      console.error('Appointment sync failed', appointment.id, error instanceof Error ? error.message : 'unknown')
      stats.errors += 1
    }
  }

  for (const event of events) {
    if (handledEvents.has(event.id) || event.status === 'cancelled' || !event.updated) continue
    const linkedId = event.extendedProperties?.private?.vatiaAppointmentId
    if (linkedId || !event.start?.dateTime || !event.end?.dateTime) continue
    const summary = normalize(event.summary ?? '')
    if (!summary) continue
    const matches = patients.filter(patient => summary.includes(normalize(patient.name)))
    if (matches.length !== 1) continue
    try {
      const patient = matches[0]
      const syncedAt = new Date().toISOString()
      await database('appointments', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          patient_id: patient.id,
          google_event_id: event.id,
          starts_at: event.start.dateTime,
          ends_at: event.end.dateTime,
          visit_type: visitTypeFromSummary(event.summary, patient.name),
          notes: '',
          google_updated_at: event.updated,
          last_synced_at: syncedAt,
          updated_at: event.updated,
        }),
      })
      stats.imported += 1
      stats.changes += 1
    } catch (error) {
      console.error('Google import failed', event.id, error instanceof Error ? error.message : 'unknown')
      stats.errors += 1
    }
  }

  await database(`calendar_connections?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ last_sync_at: stats.lastSyncAt, updated_at: stats.lastSyncAt }),
  })
  return stats
}

async function connect(request: Request, userId: string, body: JsonObject) {
  const code = String(body.code ?? '').trim()
  if (!code) throw new HttpError(400, 'Codice di autorizzazione Google mancante.')
  const token = await googleTokenResponse(new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    client_secret: env('GOOGLE_CLIENT_SECRET'),
    code,
    grant_type: 'authorization_code',
    redirect_uri: 'postmessage',
  }))
  if (!token.refresh_token) throw new HttpError(400, 'Google non ha rilasciato un token permanente. Revoca l’accesso Vatia nelle impostazioni Google e riprova.')
  const profile = await googleRequest<{ email?: string }>(token.access_token!, 'https://openidconnect.googleapis.com/v1/userinfo')
  const email = profile?.email
  if (!email) throw new HttpError(400, 'Non è stato possibile identificare l’account Google collegato.')
  const now = new Date().toISOString()
  await database('calendar_connections?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      google_email: email,
      refresh_token_encrypted: await encryptToken(token.refresh_token, userId),
      access_token_encrypted: await encryptToken(token.access_token!, userId),
      access_token_expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
      last_sync_at: null,
      updated_at: now,
    }),
  })
  return json(request, { connected: true, googleEmail: email, lastSyncAt: null })
}

async function disconnect(request: Request, userId: string) {
  const connection = await connectionFor(userId)
  if (connection) {
    try {
      const refreshToken = await decryptToken(connection.refresh_token_encrypted, userId)
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    } catch (error) { console.error('Google token revocation failed', error instanceof Error ? error.message : 'unknown') }
    await database(`calendar_connections?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' })
  }
  return json(request, { connected: false })
}

export async function handler(request: Request) {
  if (request.method === 'OPTIONS') return json(request, {}, 204)
  if (request.method !== 'POST') return json(request, { error: 'Metodo non consentito.' }, 405)
  try {
    const body = await bodyOf(request)
    const action = String(body.action ?? '')
    if (action === 'sync_all') {
      if (request.headers.get('x-vatia-cron-key') !== env('CRON_SECRET')) throw new HttpError(401, 'Autorizzazione schedulazione non valida.')
      const connections = await database<Pick<Connection, 'user_id'>[]>('calendar_connections?select=user_id&order=last_sync_at.asc.nullsfirst&limit=50')
      const total = { users: 0, changes: 0, errors: 0 }
      for (const item of connections) {
        try {
          const connection = await requireConnection(item.user_id)
          const stats = await syncConnection(connection)
          total.users += 1
          total.changes += stats.changes
          total.errors += stats.errors
        } catch (error) {
          console.error('Scheduled user sync failed', item.user_id, error instanceof Error ? error.message : 'unknown')
          total.errors += 1
        }
      }
      return json(request, total)
    }

    const userId = await verifyUser(request)
    if (action === 'connect') return await connect(request, userId, body)
    if (action === 'disconnect') return await disconnect(request, userId)
    if (action === 'status') {
      const connection = await connectionFor(userId)
      return json(request, connection
        ? { connected: true, googleEmail: connection.google_email, lastSyncAt: connection.last_sync_at }
        : { connected: false })
    }
    if (action === 'list') {
      const interval = validInterval(body.timeMin, body.timeMax)
      const connection = await requireConnection(userId)
      const accessToken = await validAccessToken(connection)
      const events = await listEvents(accessToken, interval.start, interval.end, false)
      return json(request, { items: events.filter(event => event.status !== 'cancelled') })
    }
    if (action === 'push') {
      const connection = await requireConnection(userId)
      const appointmentId = String(body.appointmentId ?? '')
      const rows = await database<Appointment[]>(`appointments?id=eq.${encodeURIComponent(appointmentId)}&user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`)
      const appointment = rows[0]
      if (!appointment) throw new HttpError(404, 'Appuntamento Vatia non trovato.')
      const [patients, offices] = await Promise.all([
        database<Patient[]>(`patients?user_id=eq.${encodeURIComponent(userId)}&select=id,name`),
        database<Office[]>(`offices?user_id=eq.${encodeURIComponent(userId)}&select=id,name,address,city,postal_code,province`),
      ])
      const accessToken = await validAccessToken(connection)
      const result = await pushAppointment(
        accessToken,
        appointment,
        patients.find(patient => patient.id === appointment.patient_id),
        offices.find(office => office.id === appointment.office_id),
        typeof body.includeNotes === 'boolean' ? body.includeNotes : undefined,
        typeof body.includeLocation === 'boolean' ? body.includeLocation : undefined,
      )
      return json(request, { result: result.created ? 'created' : 'updated', googleEventId: result.event.id })
    }
    if (action === 'sync') {
      const connection = await requireConnection(userId)
      const stats = await syncConnection(connection)
      return json(request, { ...stats, googleEmail: connection.google_email })
    }
    throw new HttpError(400, 'Azione Google Calendar non riconosciuta.')
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Sincronizzazione Google non riuscita.'
    const code = error instanceof HttpError ? error.code : ''
    if (status >= 500) console.error('Google Calendar function failed', message)
    return json(request, { error: message, ...(code ? { code } : {}) }, status)
  }
}

if (typeof Deno !== 'undefined') Deno.serve(handler)
