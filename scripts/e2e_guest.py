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


def fill(selector, value):
    for attempt in range(8):
        try:
            call('fill', {'selector': selector, 'value': str(value)})
            return
        except RuntimeError as error:
            if 'element not found' not in str(error) or attempt == 7:
                print('Contenuto al momento del campo mancante:', texts(snapshot()))
                raise
            time.sleep(0.5)


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
    wait_for('Il tuo primo percorso nutrizionale')
    print('PASS accesso ospite e onboarding vuoto')

    click_button('Esplora con dati demo')
    wait_for('Anna Neri (Demo)')
    wait_for('Rimuovi demo')
    time.sleep(2)
    screenshot('dashboard-demo-desktop.jpg')
    click_button('Rimuovi demo')
    wait_for('Il tuo primo percorso nutrizionale')
    if evaluate('JSON.parse(localStorage.getItem("vatia-v3-patients")||"[]").some(p=>p.id.startsWith("demo-"))'):
        raise AssertionError('La rimozione demo non ha ripulito i dati locali')
    print('PASS caricamento e rimozione completa dei dati demo')

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
    if evaluate("document.querySelector('.modal [name=goal]').value") != 'Aumento della massa muscolare':
        raise AssertionError('Il cambio obiettivo non aggiorna il testo')
    click_button('Dimagrimento', contains=True, scope='.objective-grid')
    fill('.modal input[name="calories"]', 500)
    if not evaluate('document.querySelector(".wizard-actions .heading-actions .button.primary").disabled'):
        raise AssertionError('Il wizard accetta un target calorico fuori limite')
    fill('.modal input[name="calories"]', 1800)
    click_button('Crea paziente', scope='.modal')
    wait_for_modal_close()
    wait_for(patient_name)
    print('PASS wizard, limiti clinici e sincronizzazione obiettivo')

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
    print(f'PASS composizione, ottimizzazione, grammi e alternative ({food_rows} alimenti)')

    evaluate('window.__auditConfirm=window.confirm;window.__auditConfirmCalls=0;window.confirm=()=>{window.__auditConfirmCalls++;return false};true')
    click_button('Pazienti', contains=True, scope='.main-nav')
    time.sleep(1)
    if not evaluate('Boolean(document.querySelector(".diet-builder"))') or not evaluate('window.__auditConfirmCalls > 0'):
        raise AssertionError('La navigazione non protegge le modifiche non salvate')
    evaluate('window.confirm=window.__auditConfirm;delete window.__auditConfirm;delete window.__auditConfirmCalls;true')
    print('PASS protezione dal lavoro non salvato')

    click_button('Copia giorno')
    click_button('Copia in 6 giorni', scope='.modal')
    wait_for('Giornata copiata in 6 giorni')
    click_button('Salva bozza')
    wait_for('Bozza salvata')
    click_button('Segna come pronta')
    wait_for('Piano salvato e pronto')
    print('PASS copia settimanale e salvataggio piano pronto')

    click_button('Anteprima')
    wait_for('Piano settimanale')
    if evaluate('document.querySelectorAll(".print-week .preview-day").length') != 7:
        raise AssertionError('La stampa non contiene tutti i sette giorni')
    screenshot('preview-week-desktop.jpg')
    call('cdp', {'method': 'Emulation.setEmulatedMedia', 'params': {'media': 'print'}})
    try:
        if not evaluate('getComputedStyle(document.querySelector(".print-week")).display === "block" && getComputedStyle(document.querySelector(".screen-week")).display === "none"'):
            raise AssertionError('Il CSS di stampa non sostituisce il giorno attivo con la settimana completa')
    finally:
        call('cdp', {'method': 'Emulation.setEmulatedMedia', 'params': {'media': ''}})
    click_button('Lista spesa', contains=True)
    shopping_count = evaluate('document.querySelectorAll(".shopping-list > button").length')
    if not shopping_count:
        raise AssertionError('Lista spesa vuota nonostante il piano composto')
    call('click', {'selector': '.shopping-list > button'})
    if not evaluate('document.querySelector(".shopping-list > button").getAttribute("aria-pressed") === "true"'):
        raise AssertionError('La spunta della lista spesa non funziona')
    if not evaluate('document.querySelectorAll(".shopping-category").length > 1'):
        raise AssertionError('La lista spesa non è raggruppata per categoria')
    screenshot('preview-shopping-desktop.jpg')
    call('click', {'selector': '.modal-close'})
    screenshot('builder-desktop.jpg')
    assert_no_overflow('builder desktop')
    set_mobile()
    screenshot('builder-mobile.jpg')
    assert_no_overflow('builder mobile')
    set_mobile(False)
    print('PASS stampa sette giorni, lista spesa interattiva e builder responsive')

    click_button('Diario alimentare', contains=True)
    wait_for('Piano di confronto')
    if not any(plan_name in value for value in texts(snapshot())):
        raise AssertionError('Il diario non usa il piano appena salvato')
    copied = evaluate('(()=>{const section=Array.from(document.querySelectorAll(".diary-meal-compare")).find(s=>s.querySelector("h2")?.innerText==="Cena");const button=section?.querySelector(".copy-plan-button");if(!button)return false;button.click();return true})()')
    if not copied:
        raise AssertionError('Azione rapida diario non trovata per Cena')
    wait_for('Cena:', timeout=10)
    time.sleep(1)
    if not evaluate('(()=>{const s=Array.from(document.querySelectorAll(".diary-meal-compare")).find(s=>s.querySelector("h2")?.innerText==="Cena");return s?s.querySelectorAll(".diary-food").length:0})()'):
        raise AssertionError('La copia dal piano non ha generato registrazioni')
    click_button('Registra consumo')
    fill('.diary-entry-fields input[placeholder]', 'Porzione inserita durante test locale')
    fill('.modal .search-field input', 'Pasta di semola')
    click_button('Pasta di semola di grano duro', contains=True, scope='.modal')
    wait_for_modal_close()
    wait_for('Registrato dal professionista')
    screenshot('diary-desktop.jpg')
    assert_no_overflow('diario desktop')
    print('PASS diario manuale e copia del piano in una sola azione')

    click_button('Calendario')
    click_button('Nuovo appuntamento')
    fill('.modal [name="time"]', '10:15')
    fill('.modal [name="notes"]', 'Follow-up fittizio E2E locale')
    call('click', {'selector': '.modal button[type="submit"]'})
    wait_for_modal_close()
    wait_for('Follow-up fittizio E2E locale')
    appointment_text = evaluate('Array.from(document.querySelectorAll(".calendar-appointment")).map(e=>e.innerText).join(" | ")')
    if '10:15' not in appointment_text:
        raise AssertionError(f'Orario locale non corretto: {appointment_text}')
    set_mobile()
    screenshot('calendar-mobile.jpg')
    assert_no_overflow('calendario mobile')
    columns = evaluate('getComputedStyle(document.querySelector(".week-calendar")).gridTemplateColumns')
    if ' ' in columns.strip():
        raise AssertionError(f'Il calendario mobile non è un’agenda verticale: {columns}')
    set_mobile(False)
    print('PASS appuntamento alle 10:15 e agenda mobile verticale')

    click_button('Pazienti', contains=True, scope='.main-nav')
    click_button('Misurazioni')
    click_button('Nuova misurazione')
    fill('.modal [name="date"]', '2020-01-01')
    fill('.modal [name="weight"]', 50)
    fill('.modal [name="note"]', 'Misurazione storica fittizia')
    call('click', {'selector': '.modal button[type="submit"]'})
    wait_for_modal_close()
    wait_for('Misurazione storica salvata senza modificare il peso attuale')
    history = evaluate('Array.from(document.querySelectorAll(".measurement-row strong")).map(e=>e.innerText)')
    if len(history) < 2 or history[0] != '67.5 kg' or history[-1] != '50 kg':
        raise AssertionError(f'Ordine misurazioni o peso attuale errato: {history}')
    print('PASS storico misurazioni senza sovrascrivere il peso attuale')

    click_button('Database alimenti', contains=True)
    click_button('Nuovo alimento')
    fill('.modal [name="name"]', f'Alimento test {suffix}')
    fill('.modal [name="kcal"]', 120)
    fill('.modal [name="protein"]', 8)
    fill('.modal [name="carbs"]', 15)
    fill('.modal [name="fat"]', 3)
    call('click', {'selector': '.modal button[type="submit"]'})
    wait_for_modal_close()
    wait_for(f'Alimento test {suffix}')
    payload = [
        {'name': f'Importato valido {suffix}', 'category': ' CEREALI ', 'per100g': {'kcal': 200, 'protein': 7, 'carbs': 40, 'fat': 2}},
        {'name': 'Importato non valido', 'per100g': {'kcal': 100, 'protein': -4, 'carbs': 10, 'fat': 2}},
    ]
    code = '(()=>{const input=document.querySelector("input[type=file]");const dt=new DataTransfer();dt.items.add(new File([' + json.dumps(json.dumps(payload)) + '],"test.json",{type:"application/json"}));input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true})()'
    if not evaluate(code):
        raise AssertionError('Input importazione non trovato')
    wait_for(f'Importato valido {suffix}')
    fill('.database-toolbar .search-field input', f'Importato valido {suffix}')
    wait_for(f'Importato valido {suffix}')
    if evaluate('document.body.innerText.includes("Importato non valido")'):
        raise AssertionError('È stato importato un alimento con valori negativi')
    assert_no_visible_error()
    print('PASS alimento personale e importazione JSON sanitizzata')

    call('reload')
    wait_for('Area locale attiva')
    click_button('Diete', contains=True, scope='.main-nav')
    wait_for(plan_name)
    click_button('Diario alimentare', contains=True, scope='.main-nav')
    wait_for('Registrato dal professionista')
    click_button('Calendario', scope='.main-nav')
    wait_for('Follow-up fittizio E2E locale')
    assert_no_visible_error()
    assert_no_overflow('persistenza desktop')
    print('PASS persistenza locale dopo ricaricamento')
    print('E2E OSPITE COMPLETATO')
finally:
    try:
        set_mobile(False)
        call('close_tab')
    except Exception:
        pass
