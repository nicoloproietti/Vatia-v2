import assert from 'node:assert/strict'
import { test } from 'node:test'

const userId = '00000000-0000-4000-8000-000000000001'
const patientId = '00000000-0000-4000-8000-000000000002'
const encryptionKey = Buffer.alloc(32, 7).toString('base64')
const environment = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  GOOGLE_CLIENT_ID: 'client-test',
  GOOGLE_CLIENT_SECRET: 'secret-test',
  GOOGLE_TOKEN_ENCRYPTION_KEY: encryptionKey,
  CRON_SECRET: 'cron-test',
}
globalThis.Deno = { env: { get: name => environment[name] }, serve: () => {} }

const { handler, visitTypeFromSummary } = await import('../supabase/functions/google-calendar/index.ts')

const now = Date.now()
const iso = offset => new Date(now + offset).toISOString()
const localId = '00000000-0000-4000-8000-000000000010'
const state = {
  connections: [],
  patients: [{ id: patientId, user_id: userId, name: 'Anna Neri' }],
  offices: [],
  tombstones: [],
  appointments: [{
    id: localId, user_id: userId, patient_id: patientId, office_id: null, google_event_id: null,
    starts_at: iso(86400000), ends_at: iso(86400000 + 2700000), visit_type: 'Prima visita', notes: 'Nota clinica riservata',
    google_updated_at: null, last_synced_at: null, google_include_notes: false, google_include_location: true,
    created_at: iso(-10000), updated_at: iso(-10000),
  }],
  events: [
    { id: 'remote-1', summary: 'Visita di controllo · Anna Neri', status: 'confirmed', updated: iso(-5000), start: { dateTime: iso(172800000) }, end: { dateTime: iso(172800000 + 2700000) } },
    { id: 'personal-1', summary: 'Esame Uni', status: 'confirmed', updated: iso(-5000), start: { dateTime: iso(172800000) }, end: { dateTime: iso(172800000 + 3600000) } },
  ],
  googleWrites: 0,
  revoked: false,
}

function filtered(rows, query) {
  return rows.filter(row => [...query.entries()].every(([key, value]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(key)) return true
    const [operator, expected] = value.split('.')
    if (operator !== 'eq') return true
    return String(row[key] ?? '') === expected
  }))
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const method = (init.method ?? 'GET').toUpperCase()
  const body = init.body && typeof init.body === 'string' && init.headers?.['Content-Type'] !== 'application/x-www-form-urlencoded' ? JSON.parse(init.body) : null

  if (url.origin === 'https://project.supabase.co' && url.pathname === '/auth/v1/user') {
    return init.headers?.Authorization === 'Bearer user-jwt' ? Response.json({ id: userId }) : Response.json({}, { status: 401 })
  }
  if (url.origin === 'https://project.supabase.co' && url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/').at(-1)
    const rows = state[{ calendar_connections: 'connections', calendar_tombstones: 'tombstones', appointments: 'appointments', patients: 'patients', offices: 'offices' }[table]]
    if (!rows) return Response.json({ message: 'unknown table' }, { status: 404 })
    if (method === 'GET') return Response.json(filtered(rows, url.searchParams))
    if (method === 'POST') {
      if (table === 'calendar_connections') {
        const index = rows.findIndex(row => row.user_id === body.user_id)
        if (index >= 0) rows[index] = { ...rows[index], ...body }
        else rows.push(body)
      } else rows.push({ ...body, id: body.id ?? `db-${rows.length + 1}`, created_at: body.created_at ?? iso(0) })
      return new Response(null, { status: 201 })
    }
    if (method === 'PATCH') {
      for (const row of filtered(rows, url.searchParams)) Object.assign(row, body)
      return new Response(null, { status: 204 })
    }
    if (method === 'DELETE') {
      const remove = new Set(filtered(rows, url.searchParams))
      state[{ calendar_connections: 'connections', calendar_tombstones: 'tombstones', appointments: 'appointments', patients: 'patients', offices: 'offices' }[table]] = rows.filter(row => !remove.has(row))
      return new Response(null, { status: 204 })
    }
  }
  if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') {
    const params = new URLSearchParams(init.body)
    if (params.get('grant_type') === 'authorization_code' && params.get('code') !== 'valid-code') return Response.json({ error: 'invalid_grant' }, { status: 400 })
    return Response.json({ access_token: 'google-access', refresh_token: params.get('grant_type') === 'authorization_code' ? 'google-refresh' : undefined, expires_in: 3600 })
  }
  if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/revoke') {
    state.revoked = true
    return new Response(null, { status: 200 })
  }
  if (url.origin === 'https://openidconnect.googleapis.com') return Response.json({ email: 'nutrizionista@example.com' })
  if (url.origin === 'https://www.googleapis.com') {
    if (init.headers?.Authorization !== 'Bearer google-access') return Response.json({}, { status: 401 })
    const eventId = decodeURIComponent(url.pathname.split('/').at(-1))
    if (method === 'GET' && url.pathname.endsWith('/events')) {
      const linked = url.searchParams.get('privateExtendedProperty')
      const events = linked ? state.events.filter(event => event.extendedProperties?.private?.vatiaAppointmentId === linked.split('=')[1]) : state.events.filter(event => url.searchParams.get('showDeleted') === 'true' || event.status !== 'cancelled')
      return Response.json({ items: events })
    }
    if (method === 'POST') {
      const event = { ...body, id: `google-${state.googleWrites + 1}`, status: 'confirmed', updated: iso(0) }
      state.events.push(event); state.googleWrites += 1
      return Response.json(event)
    }
    const event = state.events.find(item => item.id === eventId)
    if (!event || event.status === 'cancelled') return Response.json({}, { status: 404 })
    if (method === 'PATCH') { Object.assign(event, body, { updated: iso(100) }); state.googleWrites += 1; return Response.json(event) }
    if (method === 'DELETE') { event.status = 'cancelled'; state.googleWrites += 1; return new Response(null, { status: 204 }) }
  }
  throw new Error(`Unexpected request: ${method} ${url}`)
}

async function call(action, payload = {}, token = 'user-jwt', cronKey = '') {
  const response = await handler(new Request('https://project.supabase.co/functions/v1/google-calendar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(cronKey ? { 'x-vatia-cron-key': cronKey } : {}) },
    body: JSON.stringify({ action, ...payload }),
  }))
  const result = await response.json()
  return { response, result }
}

test('il tipo visita rimuove il nome paziente senza errori regex', () => {
  assert.equal(visitTypeFromSummary('Controllo · Anna Neri', 'Anna Neri'), 'Controllo')
  assert.equal(visitTypeFromSummary('Visita · Anna (Neri)', 'Anna (Neri)'), 'Visita')
})

test('il collegamento conserva soltanto token cifrati e non li restituisce', async () => {
  const { response, result } = await call('connect', { code: 'valid-code' })
  assert.equal(response.status, 200)
  assert.equal(result.googleEmail, 'nutrizionista@example.com')
  assert.equal(JSON.stringify(result).includes('google-refresh'), false)
  assert.equal(state.connections.length, 1)
  assert.notEqual(state.connections[0].refresh_token_encrypted, 'google-refresh')
  assert.match(state.connections[0].refresh_token_encrypted, /^v1\./)
})

test('il sync importa soltanto il paziente, invia Vatia e non duplica al secondo passaggio', async () => {
  const first = await call('sync')
  assert.equal(first.response.status, 200)
  assert.equal(first.result.imported, 1)
  assert.equal(first.result.pushed, 1)
  assert.equal(state.appointments.length, 2)
  assert.equal(state.appointments.some(item => item.visit_type === 'Esame Uni'), false)
  const pushed = state.events.find(event => event.id === state.appointments.find(item => item.id === localId)?.google_event_id)
  assert.equal(pushed.description.includes('Nota clinica riservata'), false)
  const second = await call('sync')
  assert.equal(second.result.changes, 0)
  assert.equal(state.appointments.length, 2)
})

test('una modifica Google aggiorna Vatia e una modifica successiva Vatia aggiorna Google', async () => {
  const remote = state.events.find(event => event.id === 'remote-1')
  remote.starts_at = undefined
  remote.start = { dateTime: iso(259200000) }
  remote.end = { dateTime: iso(259200000 + 3600000) }
  remote.updated = iso(1000)
  const pulled = await call('sync')
  assert.equal(pulled.result.updated, 1)
  const imported = state.appointments.find(item => item.google_event_id === 'remote-1')
  assert.equal(imported.starts_at, remote.start.dateTime)

  imported.visit_type = 'Follow-up nutrizionale'
  imported.updated_at = iso(2000)
  const pushed = await call('sync')
  assert.equal(pushed.result.pushed, 1)
  assert.match(remote.summary, /Follow-up nutrizionale/)
})

test('la cancellazione Google elimina il collegato Vatia senza toccare impegni personali', async () => {
  const remote = state.events.find(event => event.id === 'remote-1')
  remote.status = 'cancelled'
  const result = await call('sync')
  assert.equal(result.result.deleted, 1)
  assert.equal(state.appointments.some(item => item.google_event_id === 'remote-1'), false)
  assert.equal(state.events.some(item => item.id === 'personal-1' && item.status === 'confirmed'), true)
})

test('un tombstone Vatia elimina solo l’evento collegato', async () => {
  const local = state.appointments.find(item => item.id === localId)
  state.tombstones.push({ id: 'tombstone-1', user_id: userId, google_event_id: local.google_event_id })
  state.appointments = state.appointments.filter(item => item.id !== localId)
  const result = await call('sync')
  assert.equal(result.response.status, 200)
  assert.equal(state.events.find(event => event.id === local.google_event_id).status, 'cancelled')
  assert.equal(state.tombstones.length, 0)
  assert.equal(state.events.find(event => event.id === 'personal-1').status, 'confirmed')
})

test('il job periodico richiede un segreto separato dal JWT utente', async () => {
  const denied = await call('sync_all', {}, 'none', 'wrong')
  assert.equal(denied.response.status, 401)
  const allowed = await call('sync_all', {}, 'none', 'cron-test')
  assert.equal(allowed.response.status, 200)
  assert.equal(allowed.result.users, 1)
})

test('lo scollegamento revoca il token ma non elimina gli eventi', async () => {
  const { response } = await call('disconnect')
  assert.equal(response.status, 200)
  assert.equal(state.revoked, true)
  assert.equal(state.connections.length, 0)
  assert.equal(state.events.some(event => event.id === 'personal-1'), true)
})
