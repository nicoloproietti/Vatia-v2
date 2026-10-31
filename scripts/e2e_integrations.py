import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SESSION = 'vatia-integrations-audit'
ARTIFACTS = ROOT / 'test-artifacts'
DOWNLOADS = ARTIFACTS / 'downloads'
ARTIFACTS.mkdir(exist_ok=True)
DOWNLOADS.mkdir(exist_ok=True)


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


def wait_for(text, timeout=35):
    deadline = time.time() + timeout
    data = snapshot()
    while time.time() < deadline:
        data = snapshot()
        if any(text in value for value in texts(data)):
            return data
        time.sleep(.5)
    raise AssertionError(f'Testo non trovato: {text}. Ultimo contenuto: {texts(data)}')


def click_button(name, contains=False, scope=''):
    expected = json.dumps(name, ensure_ascii=False)
    comparison = f'b.innerText.includes({expected})' if contains else f'b.innerText.trim() === {expected}'
    code = f'(()=>{{const b=Array.from(document.querySelectorAll({json.dumps(scope + " button")})).find(b=>b.offsetParent!==null&&{comparison});if(!b)return false;b.click();return true}})()'
    if not evaluate(code):
        raise AssertionError(f'Pulsante non trovato: {name}. Contenuto: {texts(snapshot())}')
    time.sleep(.4)


def fill(selector, value):
    call('fill', {'selector': selector, 'value': str(value)})
    time.sleep(.15)


def screenshot(name):
    result = call('screenshot', {'format': 'jpeg', 'quality': 88, 'path': str(ARTIFACTS / name)})
    print('SCREENSHOT', result.get('path'))


def assert_page_sane(label):
    sizes = evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})')
    if sizes['document'] > sizes['viewport'] + 2:
        raise AssertionError(f'Overflow orizzontale {label}: {sizes}')
    if 'NaN' in evaluate('document.body.innerText'):
        raise AssertionError(f'NaN visibile in {label}')
    errors = evaluate('Array.from(document.querySelectorAll(".workspace-error, .auth-feedback.error")).filter(e=>e.offsetParent!==null).map(e=>e.innerText)')
    if errors:
        raise AssertionError(f'Errori visibili in {label}: {errors}')


suffix = str(int(time.time()))
call('navigate', {'url': f'http://127.0.0.1:7100/Vatia-v2/?integrations={suffix}', 'newTab': True, 'group_title': 'Vatia · test integrazioni'})
time.sleep(3)
evaluate('localStorage.clear();true')
call('reload')
wait_for('Accedi come ospite')
click_button('Accedi come ospite')
wait_for('Dal primo paziente al follow-up')
click_button('Esplora con dati demo')
wait_for('Anna Neri (Demo)')
time.sleep(1)
print('PASS ambiente demo isolato')

click_button('Agenda', scope='.main-nav')
wait_for('Calendario')
appointment_id = evaluate('document.querySelector("[data-appointment-id]")?.dataset.appointmentId')
if not appointment_id:
    raise AssertionError('Nessun appuntamento demo disponibile')
call('click', {'selector': f'[data-appointment-id="{appointment_id}"]'})
wait_for('Porta la visita nel tuo calendario')
appointment = evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-appointments")).find(a=>a.id==={json.dumps(appointment_id)})')
patient = evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-patients")).find(p=>p.id==={json.dumps(appointment["patientId"])})')
office = evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-offices")).find(o=>o.id==={json.dumps(appointment.get("officeId"))})')
evaluate('''(()=>{const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.__icsAuditBlob=blob;return create(blob)};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__icsAuditName=this.download;return}return click.call(this)};return true})()''')
click_button('Esporta .ics', scope='.calendar-actions')
time.sleep(.8)
download = evaluate('(async()=>({name:window.__icsAuditName,content:await window.__icsAuditBlob?.text()}))()')
if not download or not download.get('name', '').endswith('.ics') or not download.get('content'):
    raise AssertionError(f'Il download ICS non è stato avviato: {download}')
ics = download['content']
(ARTIFACTS / download['name']).write_text(ics)
unfolded = ics.replace('\r\n ', '')
if 'BEGIN:VCALENDAR' not in ics or 'END:VEVENT' not in ics:
    raise AssertionError('Struttura ICS non valida')
if appointment['visitType'] not in unfolded or (patient and patient['name'] not in unfolded):
    raise AssertionError('Il file ICS non contiene visita e paziente')
if office and office['name'] not in unfolded:
    raise AssertionError('Il file ICS non contiene la sede selezionata')
if appointment.get('notes') and appointment['notes'] in unfolded:
    raise AssertionError('Le note sono state esportate senza consenso esplicito')
if not evaluate('document.querySelector(".calendar-actions-buttons button:nth-child(2)")!==null'):
    raise AssertionError('Azione Google Calendar assente')
if not evaluate('document.querySelector(".calendar-actions-buttons button:nth-child(2)").disabled'):
    print('INFO client Google configurato localmente: sincronizzazione reale non eseguita dal test')
elif 'Google OAuth Client ID' not in evaluate('document.querySelector(".calendar-actions").innerText'):
    raise AssertionError('Stato Google non configurato non spiegato')
assert_page_sane('agenda e azioni calendario')
screenshot('integrations-calendar-desktop.jpg')
print('PASS download ICS, contenuto, privacy note e stato configurazione Google')

click_button('Pazienti', contains=True, scope='.main-nav')
wait_for('Pazienti')
click_button('Anamnesi', scope='.record-tabs')
wait_for('Anamnesi nutrizionale')
click_button('Detta anamnesi')
wait_for('Assistente per l’anamnesi')
evaluate('window.LanguageModel=undefined;true')
sample = 'Patologie: ipotiroidismo. Farmaci: levotiroxina 50 mcg. Allergie: nichel. Intolleranze: lattosio. Alimentazione vegetariana. Pasti fuori casa: 3. Acqua: 1,5 litri al giorno. Alcol: no. Fumo: no. Sonno: 7 ore. Stress: alto. Integratori: vitamina D. Note cliniche: preferisce cene leggere.'
fill('#anamnesis-transcript', sample)
click_button('Analizza e prepara i campi')
wait_for('Scegli i campi da applicare')
wait_for('ANALISI GUIDATA LOCALE')
for expected in ['ipotiroidismo', 'levotiroxina 50 mcg', 'nichel', 'lattosio', 'Vegetariana', '1,5 litri al giorno', '7 ore', 'vitamina D']:
    if expected not in evaluate('document.querySelector(".voice-review").innerText'):
        raise AssertionError(f'Campo non estratto: {expected}')
patient_id = evaluate('document.querySelector(".voice-anamnesis-trigger")!==null&&JSON.parse(localStorage.getItem("vatia-v3-patients")).find(p=>p.id.startsWith("demo-")).id')
before = evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-patients")).find(p=>p.id==={json.dumps(patient_id)}).anamnesis.allergies')
click_button('Applica 13 campi')
if evaluate('document.querySelector(".modal")!==null'):
    raise AssertionError('Il modale non si è chiuso dopo l’applicazione')
if evaluate('document.querySelector("[name=allergies]").value') != 'nichel':
    raise AssertionError('Allergie non applicate alla bozza')
if evaluate('document.querySelector("[name=dietType]").value') != 'Vegetariana':
    raise AssertionError('Alimentazione non applicata alla bozza')
if evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-patients")).find(p=>p.id==={json.dumps(patient_id)}).anamnesis.allergies') != before:
    raise AssertionError('L’assistente ha salvato dati clinici senza conferma esplicita')
click_button('Salva anamnesi')
time.sleep(1)
saved = evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-patients")).find(p=>p.id==={json.dumps(patient_id)}).anamnesis')
if saved['allergies'] != 'nichel' or saved['mealsOut'] != '3' or saved['dietType'] != 'Vegetariana':
    raise AssertionError(f'Anamnesi non persistita correttamente: {saved}')
assert_page_sane('anamnesi desktop')
screenshot('integrations-anamnesis-desktop.jpg')
print('PASS estrazione locale, anteprima, applicazione selettiva e salvataggio esplicito')

click_button('Detta anamnesi')
wait_for('Assistente per l’anamnesi')
evaluate('''(()=>{window.__voiceContract={};window.LanguageModel={availability:async()=>"available",create:async()=>({prompt:async(_text,options)=>{window.__voiceContract.options=options;return JSON.stringify({conditions:"",medications:"levotiroxina 50 mcg",allergies:"",intolerances:"",dietType:"",mealsOut:"",water:"",alcohol:"",smoking:"",sleep:"",stress:"",supplements:"",clinicalNotes:""})},destroy:()=>{window.__voiceContract.destroyed=true}})};return true})()''')
fill('#anamnesis-transcript', 'Il paziente dichiara di assumere levotiroxina 50 mcg.')
click_button('Analizza e prepara i campi')
wait_for('AI SUL DISPOSITIVO')
contract = evaluate('({constraint:window.__voiceContract.options?.responseConstraint,destroyed:window.__voiceContract.destroyed})')
if not contract or contract['constraint']['type'] != 'object' or not contract['destroyed']:
    raise AssertionError(f'Contratto LanguageModel non rispettato: {contract}')
call('click', {'selector': '.modal-close'})
print('PASS contratto JSON del modello simulato; non è un test del modello reale')

click_button('Detta anamnesi')
wait_for('Assistente per l’anamnesi')
call('cdp', {'method': 'Emulation.setDeviceMetricsOverride', 'params': {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True}})
time.sleep(1)
assert_page_sane('assistente vocale mobile')
if not evaluate('(()=>{const m=document.querySelector(".modal").getBoundingClientRect();return m.left>=0&&m.right<=innerWidth+1})()'):
    raise AssertionError('Il modale mobile esce dal viewport')
screenshot('integrations-voice-mobile.jpg')
call('cdp', {'method': 'Emulation.clearDeviceMetricsOverride', 'params': {}})
call('click', {'selector': '.modal-close'})
assert_page_sane('integrazioni finale')
print('PASS responsive e assenza overflow/NaN')
print('E2E INTEGRAZIONI COMPLETATO')
