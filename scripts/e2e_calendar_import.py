import json
import os
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SESSION = 'vatia-calendar-import-audit'
ARTIFACTS = ROOT / 'test-artifacts'
ARTIFACTS.mkdir(exist_ok=True)
BASE_URL = os.environ.get('VATIA_TEST_URL', 'http://127.0.0.1:7100/Vatia-v2/')


def call(action, args=None):
    payload = {'action': action, 'args': args or {}, 'session': SESSION}
    request = urllib.request.Request('http://127.0.0.1:10086/command', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    result = json.load(urllib.request.urlopen(request, timeout=45))
    if not result.get('ok'):
        raise RuntimeError(f'{action}: {result}')
    return result.get('data', {})


def evaluate(code):
    return call('evaluate', {'code': code}).get('value')


def nodes(tree):
    for node in tree:
        yield node
        yield from nodes(node.get('children', []))


def snapshot():
    return call('snapshot')


def texts(data):
    return [node.get('name') or '' for node in nodes(data['tree'])]


def wait_for(text, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = evaluate('document.body.innerText') or ''
        if text in body:
            return body
        time.sleep(.4)
    raise AssertionError(f'Testo non trovato: {text}. Ultimo contenuto: {body}')


def click_button(name, contains=False, scope=''):
    expected = json.dumps(name, ensure_ascii=False)
    comparison = f'b.innerText.includes({expected})' if contains else f'b.innerText.trim() === {expected}'
    code = f'(()=>{{const b=Array.from(document.querySelectorAll({json.dumps(scope + " button")})).find(b=>b.offsetParent!==null&&{comparison});if(!b)return false;b.click();return true}})()'
    if not evaluate(code):
        raise AssertionError(f'Pulsante non trovato: {name}. Contenuto: {texts(snapshot())}')
    time.sleep(.4)


def screenshot(name):
    result = call('screenshot', {'format': 'jpeg', 'quality': 88, 'path': str(ARTIFACTS / name)})
    print('SCREENSHOT', result.get('path'))


def assert_sane(label):
    sizes = evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})')
    if sizes['document'] > sizes['viewport'] + 2:
        raise AssertionError(f'Overflow orizzontale {label}: {sizes}')
    if 'NaN' in evaluate('document.body.innerText'):
        raise AssertionError(f'NaN visibile in {label}')
    errors = evaluate('Array.from(document.querySelectorAll(".workspace-error, .calendar-feedback.error")).filter(e=>e.offsetParent!==null).map(e=>e.innerText)')
    if errors:
        raise AssertionError(f'Errori visibili in {label}: {errors}')


suffix = str(int(time.time()))
call('navigate', {'url': f'{BASE_URL}?calendar-import={suffix}', 'newTab': True, 'group_title': 'Vatia · test importazione Google'})
time.sleep(3)
evaluate('localStorage.clear();true')
call('reload')
wait_for('Accedi come ospite')
click_button('Accedi come ospite')
wait_for('Dal primo paziente al follow-up')
click_button('Esplora con dati demo')
wait_for('Anna Neri (Demo)')
click_button('Agenda', scope='.main-nav')
wait_for('Importa da Google')
if evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.innerText.trim()==="Importa da Google")?.disabled'):
    raise AssertionError('Client Google non configurato in questo ambiente')

# Risposte Google simulate: nessun evento reale viene creato dal test automatico.
evaluate('''(()=>{
 const at=(days,hour)=>{const d=new Date();d.setDate(d.getDate()+days);d.setHours(hour,0,0,0);return d.toISOString()};
 window.__googleEvents=[
  {id:'google-e2e-1',summary:'Consulenza nutrizionale · Anna Neri (Demo)',description:'DESCRIZIONE RISERVATA DA NON IMPORTARE',start:{dateTime:at(1,14)},end:{dateTime:at(1,14)+''}},
  {id:'google-e2e-2',summary:'Riunione di studio',start:{dateTime:at(2,9)},end:{dateTime:at(2,10)}},
  {id:'google-e2e-all-day',summary:'Chiusura studio',start:{date:at(2,0).slice(0,10)},end:{date:at(3,0).slice(0,10)}}
 ];
 window.__googleEvents[0].end={dateTime:at(1,15)};
 window.__googleRequests=[];
 window.google={accounts:{oauth2:{initTokenClient:config=>({requestAccessToken:()=>config.callback({access_token:'e2e-token',expires_in:3600})})}}};
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,init={})=>{const url=String(input);if(!url.startsWith('https://www.googleapis.com/calendar/v3/'))return nativeFetch(input,init);const method=init.method||'GET';window.__googleRequests.push({url,method,body:init.body||''});if(method==='GET')return new Response(JSON.stringify({items:window.__googleEvents}),{status:200,headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify({id:url.split('/').pop()}),{status:200,headers:{'Content-Type':'application/json'}})};
 return true
})()''')

click_button('Importa da Google')
wait_for('Controlla ogni evento')
click_button('Mostra eventi')
wait_for('3 eventi trovati')
if not evaluate('document.querySelector(".calendar-import-list").innerText.includes("Consulenza nutrizionale")'):
    raise AssertionError('Evento Google non mostrato in anteprima')
if not evaluate('document.querySelector("input[aria-label=\'Seleziona Chiusura studio\']").disabled'):
    raise AssertionError('Evento di un giorno non escluso correttamente')
patient_select = evaluate('document.querySelector("select[aria-label^=\'Paziente per Consulenza nutrizionale\']").value')
demo_patient = evaluate('JSON.parse(localStorage.getItem("vatia-v3-patients")).find(p=>p.id.startsWith("demo-")).id')
if patient_select != demo_patient:
    raise AssertionError('Paziente non suggerito dal titolo')
call('click', {'selector': 'input[aria-label="Seleziona Riunione di studio"]'})
request_url = evaluate('window.__googleRequests[0].url')
if 'description' in request_url or 'attendees' in request_url:
    raise AssertionError('La richiesta include campi non necessari')
click_button('Importa 1')
time.sleep(1)
if evaluate('document.querySelector(".calendar-import-list")!==null'):
    raise AssertionError('Il pannello non si è chiuso dopo l’importazione')
imported = evaluate('JSON.parse(localStorage.getItem("vatia-v3-appointments")).filter(a=>a.googleEventId==="google-e2e-1")')
if len(imported) != 1 or imported[0]['visitType'] != 'Consulenza nutrizionale' or imported[0]['patientId'] != demo_patient or imported[0]['notes']:
    raise AssertionError(f'Importazione non corretta: {imported}')
if evaluate('JSON.parse(localStorage.getItem("vatia-v3-appointments")).some(a=>a.googleEventId==="google-e2e-2")'):
    raise AssertionError('Evento deselezionato importato per errore')
print('PASS anteprima, selezione, suggerimento paziente, privacy e importazione')

call('click', {'selector': '[data-appointment-id="%s"]' % imported[0]['id']})
wait_for('Porta la visita nel tuo calendario')
click_button('Google Calendar', scope='.calendar-actions')
wait_for('Evento Google Calendar aggiornato senza crearne un duplicato')
patches = evaluate('window.__googleRequests.filter(r=>r.method==="PATCH")')
if len(patches) != 1 or not patches[0]['url'].endswith('/google-e2e-1') or 'vatiaAppointmentId' not in patches[0]['body']:
    raise AssertionError(f'Evento importato non riutilizzato nella sincronizzazione: {patches}')
call('click', {'selector': '.modal-close'})
print('PASS aggiornamento Vatia → Google sullo stesso evento importato')

click_button('Importa da Google')
click_button('Mostra eventi')
wait_for('Già in agenda')
if not evaluate('(()=>{const r=Array.from(document.querySelectorAll(".calendar-import-row")).find(r=>r.innerText.includes("Consulenza nutrizionale"));return r.querySelector("input[type=checkbox]").disabled})()'):
    raise AssertionError('Evento già importato non bloccato contro i duplicati')
call('click', {'selector': '.modal-close'})
assert_sane('importazione desktop')
print('PASS riconoscimento evento già presente e prevenzione duplicati')

evaluate('''(()=>{const event=window.__googleEvents[0];const start=new Date(event.start.dateTime);start.setHours(start.getHours()+1);const end=new Date(event.end.dateTime);end.setHours(end.getHours()+1);event.start.dateTime=start.toISOString();event.end.dateTime=end.toISOString();event.summary='Controllo nutrizionale · Anna Neri (Demo)';return true})()''')
click_button('Importa da Google')
click_button('Mostra eventi')
wait_for('Da aggiornare')
call('click', {'selector': 'input[aria-label="Seleziona Riunione di studio"]'})
click_button('Importa 1')
time.sleep(1)
updated = evaluate('JSON.parse(localStorage.getItem("vatia-v3-appointments")).filter(a=>a.googleEventId==="google-e2e-1")')
if len(updated) != 1 or updated[0]['id'] != imported[0]['id'] or updated[0]['visitType'] != 'Controllo nutrizionale' or updated[0]['startsAt'] == imported[0]['startsAt']:
    raise AssertionError(f'Aggiornamento da Google non corretto: {updated}')
print('PASS modifica Google → Vatia senza creare un secondo appuntamento')

click_button('Importa da Google')
call('cdp', {'method': 'Emulation.setDeviceMetricsOverride', 'params': {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True}})
time.sleep(1)
assert_sane('importazione mobile')
if not evaluate('(()=>{const m=document.querySelector(".modal").getBoundingClientRect();return m.left>=0&&m.right<=innerWidth+1})()'):
    raise AssertionError('Il pannello mobile esce dal viewport')
screenshot('calendar-import-mobile.jpg')
call('cdp', {'method': 'Emulation.clearDeviceMetricsOverride', 'params': {}})
call('click', {'selector': '.modal-close'})
assert_sane('importazione finale')
print('PASS responsive e assenza overflow/NaN')
print('E2E IMPORTAZIONE GOOGLE COMPLETATO')
