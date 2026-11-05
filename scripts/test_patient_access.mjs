import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: [new URL('../src/lib/patientAccess.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false })
const access = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

function mockClient({ rpcError = null, accessError = null, emailError = null, deleteError = null, claimedAt = null } = {}) {
  const calls = []
  const row = { patient_id: 'patient-1', email: 'paziente@test.example', user_id: claimedAt ? 'patient-user' : null, invited_at: '2026-11-05T10:00:00.000Z', claimed_at: claimedAt }
  const client = {
    rpc: async (name, params) => { calls.push({ type: 'rpc', name, params }); return { error: rpcError } },
    from: table => ({
      select: columns => ({ eq: (field, value) => ({ single: async () => { calls.push({ type: 'select', table, columns, field, value }); return { data: accessError ? null : row, error: accessError } } }) }),
      delete: () => ({ eq: async (field, value) => { calls.push({ type: 'delete', table, field, value }); return { error: deleteError } } }),
    }),
    auth: { signInWithOtp: async input => { calls.push({ type: 'email', input }); return { data: { user: null, session: null }, error: emailError } } },
  }
  return { client, calls }
}
const patient = { id: 'patient-1', email: 'paziente@test.example' }

test('invito in sospeso: RPC, stato e magic link con redirect corretto', async () => {
  const { client, calls } = mockClient()
  const linked = []
  const invite = await access.sendPatientInvite(client, patient, 'https://nicoloproietti.github.io/Vatia-v2/', value => linked.push(value))
  assert.equal(invite.patientId, patient.id)
  assert.equal(invite.claimedAt, null)
  assert.equal(linked.length, 1)
  assert.deepEqual(calls[0].params, { target_patient: patient.id, target_email: patient.email })
  const email = calls.find(call => call.type === 'email').input
  assert.equal(email.email, patient.email)
  assert.equal(email.options.emailRedirectTo, 'https://nicoloproietti.github.io/Vatia-v2/')
  assert.equal('shouldCreateUser' in email.options, false)
})

test('portale attivo: claimed_at e user_id vengono conservati', async () => {
  const { client } = mockClient({ claimedAt: '2026-11-05T11:00:00.000Z' })
  const invite = await access.sendPatientInvite(client, patient, 'https://example.test/', () => {})
  assert.equal(invite.userId, 'patient-user')
  assert.equal(invite.claimedAt, '2026-11-05T11:00:00.000Z')
})

test('RPC rifiutata: nessuna lettura o email e nessuno stato simulato', async () => {
  const { client, calls } = mockClient({ rpcError: new Error('non autorizzato') })
  let linked = false
  await assert.rejects(access.sendPatientInvite(client, patient, 'https://example.test/', () => { linked = true }), /invito non consentito/)
  assert.equal(linked, false)
  assert.equal(calls.some(call => call.type === 'email' || call.type === 'select'), false)
})

test('stato non leggibile: il messaggio conferma che nessuna nuova email è partita', async () => {
  const { client, calls } = mockClient({ accessError: new Error('select negata') })
  await assert.rejects(access.sendPatientInvite(client, patient, 'https://example.test/', () => {}), /Non è stata inviata una nuova email/)
  assert.equal(calls.some(call => call.type === 'email'), false)
})

test('email fallita: autorizzazione e stato restano visibili, errore non finge rollback', async () => {
  const { client, calls } = mockClient({ emailError: new Error('rate limit') })
  const linked = []
  await assert.rejects(access.sendPatientInvite(client, patient, 'https://example.test/', value => linked.push(value)), /Autorizzazione aggiornata, ma invio email non riuscito: rate limit/)
  assert.equal(linked.length, 1)
  assert.equal(calls.filter(call => call.type === 'email').length, 1)
})

test('revoca: elimina solo patient_access del paziente e propaga gli errori', async () => {
  const success = mockClient()
  await access.revokePatientPortalAccess(success.client, patient.id)
  assert.deepEqual(success.calls[0], { type: 'delete', table: 'patient_access', field: 'patient_id', value: patient.id })
  const failure = mockClient({ deleteError: new Error('revoca negata') })
  await assert.rejects(access.revokePatientPortalAccess(failure.client, patient.id), /revoca negata/)
})

console.log('Inviti paziente verificati con mock locali: nessuna email o richiesta production.')
