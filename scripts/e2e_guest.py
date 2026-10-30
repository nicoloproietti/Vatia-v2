import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SESSION = 'vatia-product-audit'
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
            time.sleep(0.5)
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
        time.sleep(0.5)
    raise AssertionError(f'Testo non trovato: {text}. Ultimo contenuto: {texts(data)}')


def click_button(name, contains=False, scope=''):
    expected = json.dumps(name, ensure_ascii=False)
    comparison = f'b.innerText.includes({expected})' if contains else f'b.innerText.trim() === {expected}'
    code = f'(()=>{{const b=Array.from(document.querySelectorAll({json.dumps(scope + " button")})).find(b=>b.offsetParent!==null&&{comparison});if(!b)return false;b.click();return true}})()'
    if not evaluate(code):
        raise AssertionError(f'Pulsante non trovato: {name}. Contenuto: {texts(snapshot())}')
    time.sleep(.4)


def fill(selector, value, index=0):
    for attempt in range(8):
        try:
            actual = selector if index == 0 else None
            if index:
                ok = evaluate(f'(()=>{{const e=document.querySelectorAll({json.dumps(selector)})[{index}];if(!e)return false;e.dataset.auditTarget="true";return true}})()')
                if not ok:
                    raise AssertionError(f'Campo indice {index} non trovato: {selector}')
                actual = '[data-audit-target="true"]'
            call('fill', {'selector': actual, 'value': str(value)})
            if index:
                evaluate('document.querySelector("[data-audit-target]")?.removeAttribute("data-audit-target");true')
            return
        except RuntimeError as error:
            if 'element not found' not in str(error) or attempt == 7:
                print('Contenuto al momento del campo mancante:', texts(snapshot()))
                raise
            time.sleep(0.5)


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
        time.sleep(0.5)
    raise AssertionError('Il modulo non si è chiuso dopo il salvataggio')


def screenshot(name):
    result = call('screenshot', {'format': 'jpeg', 'quality': 82, 'path': str(ARTIFACTS / name)})
    print('SCREENSHOT', result.get('path'))


def assert_no_overflow(label):
    overflow = evaluate('document.documentElement.scrollWidth > window.innerWidth + 2')
    if overflow:
        sizes = evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})')
        raise AssertionError(f'Overflow orizzontale {label}: {sizes}')


def set_mobile(enabled=True):
    if enabled:
        call('cdp', {'method': 'Emulation.setDeviceMetricsOverride', 'params': {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True}})
    else:
        call('cdp', {'method': 'Emulation.clearDeviceMetricsOverride', 'params': {}})
    time.sleep(1.5)


def assert_no_visible_error():
    messages = evaluate('Array.from(document.querySelectorAll(".workspace-error, .auth-feedback.error")).filter(e=>e.offsetParent!==null).map(e=>e.innerText)')
    if messages:
        raise AssertionError(f'Errori visibili: {messages}')
    body = evaluate('document.body.innerText')
    if 'NaN' in body:
        raise AssertionError('Valore NaN visibile nell’interfaccia')


try:
    suffix = str(int(time.time()))
    patient_name = f'Mario Test {suffix}'
    plan_name = f'Piano E2E {suffix}'
    time.sleep(1)
    call('navigate', {'url': 'http://127.0.0.1:7100/Vatia-v2/', 'newTab': True})
    time.sleep(3)
    evaluate('localStorage.clear(); true')
    call('reload')
    wait_for('Accedi come ospite')
    click_button('Accedi come ospite')
    wait_for('Dal primo paziente al follow-up')
    print('PASS accesso ospite e onboarding')

    click_button('Esplora con dati demo')
    wait_for('Anna Neri (Demo)')
    wait_for('Rimuovi demo')
    time.sleep(2)
    screenshot('final-dashboard-demo.jpg')
    click_button('Fatturazione', contains=True, scope='.main-nav')
    wait_for('72,80')
    if evaluate('JSON.parse(localStorage.getItem("vatia-v3-services")||"[]").length') != 3:
        raise AssertionError('Il tariffario demo non è completo')
    click_button('Rimuovi demo', contains=True) if evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.offsetParent!==null&&b.innerText.includes("Rimuovi demo"))') else None
    click_button('Oggi', scope='.main-nav')
    click_button('Rimuovi demo')
    wait_for('Dal primo paziente al follow-up')
    if evaluate('JSON.parse(localStorage.getItem("vatia-v3-invoices")||"[]").some(p=>p.id.startsWith("demo-"))'):
        raise AssertionError('La rimozione demo non ha ripulito i documenti')
    print('PASS demo clinica e amministrativa con pulizia completa')

    click_button('Nuovo paziente')
    fill('.modal input[name="name"]', patient_name)
    fill('.modal input[name="email"]', 'mario.test@example.com')
    click_button('Continua', scope='.modal')
    fill('.modal input[name="age"]', 9)
    fill('.modal input[name="height"]', 168)
    fill('.modal input[name="weight"]', 67.5)
    if not evaluate('document.querySelector(".wizard-actions .button.primary").disabled'):
        raise AssertionError('Il wizard accetta un’età fuori limite')
    fill('.modal input[name="age"]', 37)
    click_button('Continua', scope='.modal')
    click_button('Aumento massa', contains=True, scope='.objective-grid')
    click_button('Dimagrimento', contains=True, scope='.objective-grid')
    fill('.modal input[name="calories"]', 1800)
    click_button('Crea paziente', scope='.modal')
    wait_for_modal_close()
    wait_for(patient_name)
    print('PASS creazione paziente e limiti clinici')

    click_button('Nuova dieta', scope='.record-actions')
    wait_for('BUILDER NUTRIZIONALE')
    fill('.plan-name-input', plan_name)
    click_button('Componi e ottimizza')
    time.sleep(2)
    food_rows = evaluate('document.querySelectorAll(".plan-food-row").length')
    if not food_rows or food_rows < 10:
        raise AssertionError(f'Composizione rapida incompleta: {food_rows} alimenti')
    fill('.grams-input input', 90)
    call('click', {'selector': '.plan-food-row button[title="Sostituisci con alternativa equivalente"]'})
    wait_for('Alternativa a')
    call('click', {'selector': '.food-picker-list > button'})
    wait_for_modal_close()
    wait_for('Alimento sostituito')
    click_button('Copia giorno')
    click_button('Copia in 6 giorni', scope='.modal')
    wait_for('Giornata copiata in 6 giorni')
    click_button('Salva bozza')
    wait_for('Bozza salvata')
    click_button('Segna come pronta')
    wait_for('Piano salvato e pronto')
    click_button('Anteprima')
    wait_for('Piano settimanale')
    if evaluate('document.querySelectorAll(".print-week .preview-day").length') != 7:
        raise AssertionError('La stampa non contiene tutti i sette giorni')
    click_button('Lista spesa', contains=True)
    if not evaluate('document.querySelectorAll(".shopping-list > button").length'):
        raise AssertionError('Lista spesa vuota nonostante il piano composto')
    call('click', {'selector': '.shopping-list > button'})
    if not evaluate('document.querySelector(".shopping-list > button").getAttribute("aria-pressed") === "true"'):
        raise AssertionError('La spunta della lista spesa non funziona')
    call('click', {'selector': '.modal-close'})
    print(f'PASS builder completo, stampa e spesa ({food_rows} alimenti)')

    click_button('Monitoraggio', scope='.main-nav')
    wait_for('Aderenza e follow-up')
    wait_for('A COSA SERVE')
    call('click', {'selector': '.monitoring-patient'})
    wait_for('Piano di confronto')
    if not any(plan_name in value for value in texts(snapshot())):
        raise AssertionError('Il monitoraggio non usa il piano appena salvato')
    copied = evaluate('(()=>{const section=Array.from(document.querySelectorAll(".diary-meal-compare")).find(s=>s.querySelector("h2")?.innerText==="Cena");const button=section?.querySelector(".copy-plan-button");if(!button)return false;button.click();return true})()')
    if not copied:
        raise AssertionError('Azione rapida monitoraggio non trovata per Cena')
    wait_for('Cena:', timeout=10)
    click_button('Registra consumo')
    fill('.diary-entry-fields input[placeholder]', 'Porzione inserita durante test locale')
    fill('.modal .search-field input', 'Pasta di semola')
    click_button('Pasta di semola di grano duro', contains=True, scope='.modal')
    wait_for_modal_close()
    wait_for('Registrato dal professionista')
    screenshot('final-monitoring-detail.jpg')
    click_button('Panoramica pazienti')
    click_button('Prepara follow-up')
    wait_for('Follow-up preparato')
    print('PASS monitoraggio trasversale, confronto e follow-up')

    click_button('Agenda', scope='.main-nav')
    click_button('Nuovo appuntamento')
    fill('.modal [name="time"]', '10:15')
    fill('.modal [name="notes"]', 'Follow-up fittizio E2E locale')
    call('click', {'selector': '.modal button[type="submit"]'})
    wait_for_modal_close()
    appointment_id = evaluate('JSON.parse(localStorage.getItem("vatia-v3-appointments")).find(a=>a.notes==="Follow-up fittizio E2E locale").id')
    if not appointment_id:
        raise AssertionError('Appuntamento non persistito')
    if not evaluate(f'new Date(JSON.parse(localStorage.getItem("vatia-v3-appointments")).find(a=>a.id==={json.dumps(appointment_id)}).startsAt).getHours()===10'):
        raise AssertionError('Orario locale non corretto')
    dragged = evaluate(f'''(()=>{{const source=document.querySelector('[data-appointment-id={json.dumps(appointment_id)}]');const target=Array.from(document.querySelectorAll('[data-agenda-day]')).find(x=>x.dataset.agendaDay!==new Date(JSON.parse(localStorage.getItem('vatia-v3-appointments')).find(a=>a.id==={json.dumps(appointment_id)}).startsAt).toLocaleDateString('en-CA'));if(!source||!target)return false;const dt=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{{bubbles:true,dataTransfer:dt}}));const r=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('dragover',{{bubbles:true,dataTransfer:dt,clientY:r.top+504}}));target.dispatchEvent(new DragEvent('drop',{{bubbles:true,dataTransfer:dt,clientY:r.top+504}}));source.dispatchEvent(new DragEvent('dragend',{{bubbles:true,dataTransfer:dt}}));return true}})()''')
    if not dragged:
        raise AssertionError('Elementi per drag-and-drop non trovati')
    time.sleep(1.5)
    if not evaluate(f'new Date(JSON.parse(localStorage.getItem("vatia-v3-appointments")).find(a=>a.id==={json.dumps(appointment_id)}).startsAt).getHours()===14'):
        raise AssertionError('Il drag-and-drop non ha spostato la visita alle 14:00')
    resized = evaluate(f'''(()=>{{const event=document.querySelector('[data-appointment-id={json.dumps(appointment_id)}]');const handle=event?.querySelector('.agenda-resize-handle');if(!handle)return false;const r=handle.getBoundingClientRect();window.__resizeY=r.top;handle.dispatchEvent(new PointerEvent('pointerdown',{{bubbles:true,clientY:r.top}}));return true}})()''')
    if not resized:
        raise AssertionError('Handle ridimensionamento non trovato')
    time.sleep(.5)
    evaluate('window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientY:window.__resizeY+36}));true')
    time.sleep(.5)
    evaluate('window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientY:window.__resizeY+36}));delete window.__resizeY;true')
    time.sleep(1.5)
    duration = evaluate(f'(()=>{{const a=JSON.parse(localStorage.getItem("vatia-v3-appointments")).find(a=>a.id==={json.dumps(appointment_id)});return (new Date(a.endsAt)-new Date(a.startsAt))/60000}})()')
    if duration != 75:
        raise AssertionError(f'Ridimensionamento non riuscito: durata {duration}')
    screenshot('final-agenda-desktop.jpg')
    set_mobile()
    screenshot('final-agenda-mobile.jpg')
    assert_no_overflow('agenda mobile')
    if not evaluate('getComputedStyle(document.querySelector(".agenda-shell")).display === "none" && getComputedStyle(document.querySelector(".agenda-list-view")).display !== "none"'):
        raise AssertionError('La vista mobile non usa l’agenda compatta')
    set_mobile(False)
    print('PASS agenda: creazione, drag-and-drop, resize e mobile')

    click_button('Fatturazione', contains=True, scope='.main-nav')
    click_button('Tariffario', contains=True, scope='.billing-tabs')
    click_button('Nuova prestazione')
    fill('.modal [name="serviceName"]', f'Consulenza E2E {suffix}')
    fill('.modal input[type="number"]', 50, index=0)
    fill('.modal input[type="number"]', 100, index=1)
    call('click', {'selector': '.modal button[type="submit"]'})
    wait_for_modal_close()
    wait_for(f'Consulenza E2E {suffix}')
    click_button('Dati studio', scope='.billing-tabs')
    settings_values = ['Studio E2E', 'Dott. Test E2E', 'TSTTST80A01H501Z', '01234567890', '12345', 'Via Test 1', '00100', 'Roma', 'RM', 'e2e@example.com', '06000000']
    for index, value in enumerate(settings_values):
        fill('.settings-grid input', value, index=index)
    click_button('Salva dati studio')
    wait_for('Dati dello studio salvati')
    click_button('Documenti', contains=True, scope='.billing-tabs')
    click_button('Nuovo documento')
    fill('.modal [name="recipientTaxCode"]', 'TSTTST80A01H501Z')
    fill('.modal [name="recipientAddress"]', 'Via Test 2, 00100 Roma (RM)')
    select('.modal [name="status"]', 'Emessa')
    wait_for('106,00')
    call('click', {'selector': '.modal button[type="submit"]'})
    wait_for_modal_close()
    wait_for('Documento salvato')
    invoice_id = evaluate('JSON.parse(localStorage.getItem("vatia-v3-invoices")).find(i=>i.description.startsWith("Consulenza E2E")).id')
    if not invoice_id:
        raise AssertionError('Documento non salvato')
    click_button('Incassa')
    wait_for('segnata come pagata')
    if not evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-invoices")).find(i=>i.id==={json.dumps(invoice_id)}).status==="Pagata"'):
        raise AssertionError('Incasso non persistito')
    click_button('Report economico', scope='.billing-tabs')
    wait_for('106,00')
    screenshot('final-billing-report.jpg')
    print('PASS tariffario, dati studio, ENPAB, bollo, emissione, incasso e report')

    click_button('Database alimenti', contains=True, scope='.main-nav')
    click_button('Nuovo alimento')
    fill('.modal [name="name"]', f'Alimento test {suffix}')
    fill('.modal [name="kcal"]', 120)
    fill('.modal [name="protein"]', 8)
    fill('.modal [name="carbs"]', 15)
    fill('.modal [name="fat"]', 3)
    call('click', {'selector': '.modal button[type="submit"]'})
    wait_for_modal_close()
    wait_for(f'Alimento test {suffix}')
    print('PASS database alimenti personale')

    call('reload')
    wait_for('Area locale attiva')
    click_button('Diete', contains=True, scope='.main-nav')
    wait_for(plan_name)
    click_button('Agenda', scope='.main-nav')
    wait_for('Calendario')
    if not evaluate(f'JSON.parse(localStorage.getItem("vatia-v3-appointments")).some(a=>a.id==={json.dumps(appointment_id)})'):
        raise AssertionError('Appuntamento non persistito dopo reload')
    click_button('Fatturazione', contains=True, scope='.main-nav')
    wait_for(f'Consulenza E2E {suffix}')
    click_button('Insight di studio', scope='.main-nav')
    wait_for('Insight di studio')
    wait_for('106,00')
    assert_no_visible_error()
    assert_no_overflow('persistenza desktop')
    set_mobile()
    screenshot('final-insights-mobile.jpg')
    assert_no_overflow('insight mobile')
    set_mobile(False)
    print('PASS persistenza locale, insight economici e responsive finale')
    print('E2E OSPITE COMPLETATO')
finally:
    try:
        set_mobile(False)
        call('close_tab')
    except Exception:
        pass
