import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SESSION = 'vatia-studio-audit'
ARTIFACTS = ROOT / 'test-artifacts'
ARTIFACTS.mkdir(exist_ok=True)


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
    for attempt in range(8):
        try:
            return call('snapshot')
        except RuntimeError as error:
            if 'connection changed' not in str(error) or attempt == 7:
                raise
            time.sleep(.5)
    raise RuntimeError('Snapshot non disponibile')


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


def fill_field(label, value):
    marked = evaluate(f'(()=>{{const field=Array.from(document.querySelectorAll(".modal label")).find(l=>l.querySelector("span")?.innerText.trim()==={json.dumps(label)});const input=field?.querySelector("input, textarea, select");if(!input)return false;input.dataset.studioAudit="true";return true}})()')
    if not marked:
        raise AssertionError(f'Campo non trovato: {label}')
    try:
        fill('[data-studio-audit="true"]', value)
    finally:
        evaluate('document.querySelector("[data-studio-audit]")?.removeAttribute("data-studio-audit");true')


def select(selector, value):
    ok = evaluate(f'(()=>{{const e=document.querySelector({json.dumps(selector)});if(!e)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set;setter.call(e,{json.dumps(value)});e.dispatchEvent(new Event("change",{{bubbles:true}}));return true}})()')
    if not ok:
        raise AssertionError(f'Select non trovata: {selector}')
    time.sleep(.3)


def wait_for_modal_close(timeout=35):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not evaluate('Boolean(document.querySelector(".modal"))'):
            return
        time.sleep(.5)
    raise AssertionError('Il modulo non si è chiuso dopo il salvataggio')


def screenshot(name):
    result = call('screenshot', {'format': 'jpeg', 'quality': 85, 'path': str(ARTIFACTS / name)})
    print('SCREENSHOT', result.get('path'))


def set_mobile(enabled=True):
    if enabled:
        call('cdp', {'method': 'Emulation.setDeviceMetricsOverride', 'params': {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True}})
    else:
        call('cdp', {'method': 'Emulation.clearDeviceMetricsOverride', 'params': {}})
    time.sleep(1.5)


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
office_name = f'Studio Test {suffix}'
notes = f'Visita fittizia multi-sede {suffix}'

call('navigate', {'url': f'http://127.0.0.1:7100/Vatia-v2/?studio={suffix}', 'newTab': True, 'group_title': 'Vatia · test studio'})
time.sleep(3)
evaluate('localStorage.clear();true')
call('reload')
wait_for('Accedi come ospite')
click_button('Accedi come ospite')
wait_for('Dal primo paziente al follow-up')
click_button('Esplora con dati demo')
wait_for('Anna Neri (Demo)')
time.sleep(1.5)
print('PASS accesso ospite e dati demo isolati')

if evaluate('document.querySelectorAll(".dashboard-widget").length') != 8:
    raise AssertionError('La dashboard iniziale non contiene otto widget')
click_button('Personalizza')
initial_order = evaluate('JSON.parse(localStorage.getItem("vatia-dashboard-guest")).map(w=>w.id)')
if initial_order[:3] != ['visits', 'patients', 'actions']:
    raise AssertionError(f'Ordine iniziale inatteso: {initial_order}')
dragged = evaluate('''(()=>{const source=document.querySelector('[data-widget-id="visits"]');const target=document.querySelector('[data-widget-id="actions"]');if(!source||!target)return false;const dt=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dt}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));return true})()''')
if not dragged:
    raise AssertionError('Drag widget non avviato')
time.sleep(.7)
order = evaluate('JSON.parse(localStorage.getItem("vatia-dashboard-guest")).map(w=>w.id)')
if order[2] != 'visits':
    raise AssertionError(f'Riordino widget non persistito: {order}')
call('click', {'selector': '[data-widget-id="visits"] .widget-controls button[title^="Ridimensiona"]'})
time.sleep(.5)
if not evaluate('JSON.parse(localStorage.getItem("vatia-dashboard-guest")).find(w=>w.id==="visits").size==="medium"'):
    raise AssertionError('Ridimensionamento widget non salvato')
call('click', {'selector': '[data-widget-id="patients"] .widget-controls button[title^="Nascondi"]'})
time.sleep(.5)
if evaluate('document.querySelectorAll(".dashboard-widget").length') != 7:
    raise AssertionError('Widget non nascosto')
if not evaluate('JSON.parse(localStorage.getItem("vatia-dashboard-guest")).find(w=>w.id==="patients").visible===false'):
    raise AssertionError('Visibilità widget non salvata')
click_button('Pazienti attivi', contains=True, scope='.widget-gallery')
time.sleep(.5)
if evaluate('document.querySelectorAll(".dashboard-widget").length') != 8:
    raise AssertionError('Widget non riaggiunto dalla galleria')
screenshot('studio-dashboard-customizer.jpg')
call('reload')
wait_for('Personalizza')
persisted = evaluate('JSON.parse(localStorage.getItem("vatia-dashboard-guest"))')
if persisted[2]['id'] != 'visits' or persisted[2]['size'] != 'medium' or not next(item for item in persisted if item['id'] == 'patients')['visible']:
    raise AssertionError(f'Layout non persistente dopo reload: {persisted}')
click_button('Personalizza')
click_button('Ripristina')
click_button('Salva e chiudi')
print('PASS drag-and-drop, resize, nascondi/riaggiungi e persistenza widget')

click_button('Sedi', scope='.main-nav')
wait_for('Sedi e disponibilità')
if evaluate('document.querySelectorAll(".office-card").length') != 2:
    raise AssertionError('Le due sedi demo non sono visibili')
click_button('Nuova sede')
fill_field('Nome sede', office_name)
fill_field('Indirizzo', 'Via Test 10')
fill_field('CAP', '10100')
fill_field('Città', 'Torino')
fill_field('Provincia', 'TO')
fill_field('Telefono', '0110000000')
fill_field('Email', 'studio.test@example.com')
fill_field('Apertura', '09:00')
fill_field('Chiusura', '18:00')
click_button('Salva sede', scope='.modal')
wait_for_modal_close()
wait_for(office_name)
office_id = evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-offices")).find(o=>o.name==={json.dumps(office_name)}).id')
if not office_id:
    raise AssertionError('Sede non persistita')
assert_page_sane('sedi desktop')
screenshot('studio-offices-desktop.jpg')
print('PASS creazione sede con indirizzo, contatti, giorni e orari')

opened = evaluate(f'(()=>{{const card=Array.from(document.querySelectorAll(".office-card")).find(c=>c.querySelector("h2")?.innerText==={json.dumps(office_name)});const button=Array.from(card?.querySelectorAll("button")||[]).find(b=>b.innerText.includes("Apri agenda"));if(!button)return false;button.click();return true}})()')
if not opened:
    raise AssertionError('Apertura agenda della sede non riuscita')
wait_for('Calendario')
if not evaluate(f"document.querySelector('.agenda-office-filter').value === {json.dumps(office_id)}"):
    raise AssertionError('Il filtro agenda non è sincronizzato con la sede scelta')
click_button('Nuovo appuntamento')
patient_id = evaluate('JSON.parse(localStorage.getItem("vatia-v3-patients")).find(p=>p.id.startsWith("demo-")).id')
select('.modal [name="patientId"]', patient_id)
if not evaluate(f"document.querySelector('.modal [name=officeId]').value === {json.dumps(office_id)}"):
    raise AssertionError('La sede filtrata non è proposta nel nuovo appuntamento')
fill('.modal [name="time"]', '20:00')
fill('.modal [name="notes"]', notes)
wait_for('fuori dai giorni o dagli orari')
call('click', {'selector': '.modal button[type="submit"]'})
wait_for_modal_close()
appointment_id = evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-appointments")).find(a=>a.notes==={json.dumps(notes)}).id')
appointment = evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-appointments")).find(a=>a.id==={json.dumps(appointment_id)})')
if appointment['officeId'] != office_id:
    raise AssertionError('Appuntamento non collegato alla sede')
call('click', {'selector': f'[data-appointment-id="{appointment_id}"]'})
wait_for('fuori dai giorni o dagli orari')
call('click', {'selector': '.modal-close'})
other_office = evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-offices")).find(o=>o.id!=={json.dumps(office_id)}).id')
select('.agenda-office-filter', other_office)
if evaluate(f"Array.from(document.querySelectorAll('[data-appointment-id]')).some(e=>e.dataset.appointmentId==={json.dumps(appointment_id)})"):
    raise AssertionError('Il filtro sede non nasconde la visita di un’altra sede')
select('.agenda-office-filter', office_id)
if not evaluate(f"Array.from(document.querySelectorAll('[data-appointment-id]')).some(e=>e.dataset.appointmentId==={json.dumps(appointment_id)})"):
    raise AssertionError('La visita non ricompare ripristinando il filtro sede')
click_button('Agenda', scope='.agenda-view-switch')
if office_name not in evaluate('document.querySelector(".agenda-list-view").textContent'):
    raise AssertionError('La vista compatta non mostra il nome della sede')
if not evaluate('getComputedStyle(document.querySelector(".agenda-list-view")).display!=="none"&&document.querySelector(".agenda-list-view").getBoundingClientRect().height>100'):
    raise AssertionError('La vista Agenda non è realmente visibile su desktop')
if not evaluate('document.querySelector(".agenda-list-main .avatar").getBoundingClientRect().width<=50'):
    raise AssertionError('L’avatar della vista Agenda si espande oltre la dimensione prevista')
assert_page_sane('agenda desktop')
screenshot('studio-agenda-office.jpg')
print('PASS appuntamento con sede, avviso orari, filtro e vista compatta')

click_button('Oggi', scope='.main-nav')
wait_for('Buongiorno')
if not evaluate('document.querySelector(".command-appointments .avatar").getBoundingClientRect().width<=50'):
    raise AssertionError('L’avatar della dashboard si espande oltre la dimensione prevista')
assert_page_sane('dashboard desktop')
screenshot('studio-dashboard-desktop.jpg')
set_mobile()
assert_page_sane('dashboard mobile')
widget_widths = evaluate('Array.from(document.querySelectorAll(".dashboard-widget")).map(w=>Math.round(w.getBoundingClientRect().width))')
if len(widget_widths) != 8 or max(widget_widths) - min(widget_widths) > 2:
    raise AssertionError(f'I widget mobile non occupano tutta la larghezza: {widget_widths}')
if not evaluate('Array.from(document.querySelectorAll(".page-heading > .heading-actions > *")).every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})'):
    raise AssertionError('Le azioni della dashboard mobile escono dal viewport')
screenshot('studio-dashboard-mobile.jpg')
set_mobile(False)
call('reload')
wait_for('Personalizza')
if not evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-offices")).some(o=>o.id==={json.dumps(office_id)})&&JSON.parse(localStorage.getItem("vatia-v3-appointments")).some(a=>a.id==={json.dumps(appointment_id)}&&a.officeId==={json.dumps(office_id)})'):
    raise AssertionError('Sede o appuntamento non persistenti dopo reload')
assert_page_sane('persistenza finale')
print('PASS mobile, assenza overflow/NaN e persistenza finale')
print('E2E STUDIO COMPLETATO')
