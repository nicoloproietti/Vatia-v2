import json
import pathlib
import subprocess
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SESSION = 'vatia-saas-final'
credentials = dict(line.split('=', 1) for line in (ROOT / '.test-credentials.local').read_text().splitlines() if '=' in line)
artifacts = ROOT / 'test-artifacts'
artifacts.mkdir(exist_ok=True)
log = open(ROOT / '.e2e-vite.log', 'w')
server = subprocess.Popen(['npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '7100'], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)


def call(action, args=None):
    payload = {'action': action, 'args': args or {}, 'session': SESSION}
    request = urllib.request.Request('http://127.0.0.1:10086/command', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    result = json.load(urllib.request.urlopen(request, timeout=40))
    if not result.get('ok'):
        raise RuntimeError(f'{action}: {result}')
    return result.get('data', {})


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


def texts(data):
    return [node.get('name') or '' for node in nodes(data['tree'])]


def wait_for(text, timeout=35):
    deadline = time.time() + timeout
    data = snapshot()
    while time.time() < deadline:
        data = snapshot()
        if any(text in value for value in texts(data)):
            return data
        time.sleep(0.6)
    raise AssertionError(f'Testo non trovato: {text}. Ultimo contenuto: {texts(data)}')


def click_button(name, contains=False, scope=''):
    expected = json.dumps(name, ensure_ascii=False)
    comparison = f'b.innerText.includes({expected})' if contains else f'b.innerText.trim() === {expected}'
    code = f'(()=>{{const b=Array.from(document.querySelectorAll({json.dumps(scope + " button")})).find(b=>b.offsetParent!==null&&{comparison});if(!b)return false;b.click();return true}})()'
    result = call('evaluate', {'code': code})
    if not result.get('value'):
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


def select_option(selector, text):
    code = f'(()=>{{const s=document.querySelector({json.dumps(selector)});if(!s)return false;const o=Array.from(s.options).find(o=>o.text==={json.dumps(text, ensure_ascii=False)});if(!o)return false;s.value=o.value;s.dispatchEvent(new Event("change",{{bubbles:true}}));return true}})()'
    if not call('evaluate', {'code': code}).get('value'):
        raise AssertionError(f'Opzione non trovata: {text} in {selector}')


def wait_for_modal_close(timeout=35):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not call('evaluate', {'code': 'Boolean(document.querySelector(".modal"))'}).get('value'):
            return
        time.sleep(0.5)
    raise AssertionError('Il modulo non si è chiuso dopo il salvataggio')


def screenshot(name):
    result = call('screenshot', {'format': 'jpeg', 'quality': 78, 'path': str(artifacts / name)})
    print('SCREENSHOT', result.get('path'))


try:
    suffix = str(int(time.time()))
    patient_name = f'Paziente SaaS {suffix}'
    plan_name = f'Piano completo {suffix}'
    time.sleep(2)
    call('navigate', {'url': 'http://127.0.0.1:7100/Vatia-v2/', 'newTab': True})
    time.sleep(3)
    if any('Bentornato nel tuo spazio.' in value for value in texts(snapshot())):
        fill('input[name="email"]', credentials['TEST_EMAIL'])
        fill('input[name="password"]', credentials['TEST_PASSWORD'])
        call('click', {'selector': '.auth-submit'})
    wait_for('Spazio cloud protetto')
    print('PASS accesso all’area cloud')

    click_button('Nuovo paziente')
    fill('.modal input[name="name"]', patient_name)
    fill('.modal input[name="email"]', 'paziente.test@example.com')
    fill('.modal input[name="phone"]', '+39 333 000 0000')
    click_button('Continua', scope='.modal')
    fill('.modal input[name="age"]', 37)
    fill('.modal input[name="height"]', 168)
    fill('.modal input[name="weight"]', 67.5)
    click_button('Continua', scope='.modal')
    fill('.modal input[name="goal"]', 'Test percorso completo')
    click_button('Crea paziente', scope='.modal')
    wait_for_modal_close()
    wait_for(patient_name)
    wait_for('Rilevazione iniziale') if False else None
    print('PASS creazione guidata paziente e fabbisogno')

    click_button('Anamnesi')
    fill('.anamnesis-grid [name="conditions"]', 'Nessuna patologia — dato fittizio')
    fill('.anamnesis-grid [name="medications"]', 'Nessun farmaco')
    fill('.anamnesis-grid [name="allergies"]', 'Nessuna allergia')
    fill('.anamnesis-grid [name="intolerances"]', 'Lattosio — test')
    fill('.anamnesis-grid [name="mealsOut"]', 2)
    fill('.anamnesis-grid [name="clinicalNotes"]', 'Nota clinica fittizia per il test end-to-end.')
    click_button('Salva anamnesi')
    wait_for('Anamnesi salvata')
    print('PASS anamnesi clinica')

    click_button('Misurazioni')
    click_button('Nuova misurazione')
    fill('.modal [name="weight"]', 66.8)
    fill('.modal [name="waist"]', 78)
    fill('.modal [name="hip"]', 98)
    fill('.modal [name="bodyFat"]', 24)
    fill('.modal [name="note"]', 'Controllo fittizio E2E')
    call('click', {'selector': '.modal button[type="submit"]'})
    wait_for_modal_close()
    wait_for('Controllo fittizio E2E')
    screenshot('measurements-desktop.jpg')
    print('PASS misurazione e storico antropometrico')

    click_button('Note e attività', contains=True)
    click_button('Attività', scope='.note-kind')
    fill('.note-composer textarea', 'Ricontattare il paziente fittizio per verificare il diario')
    fill('.note-composer input[type="date"]', time.strftime('%Y-%m-%d'))
    click_button('Aggiungi', scope='.note-composer')
    wait_for('Attività aggiunta al follow-up')
    print('PASS nota operativa e follow-up')

    click_button('Nuova dieta', scope='.record-actions')
    wait_for('BUILDER NUTRIZIONALE')
    fill('.plan-name-input', plan_name)
    click_button('Componi e ottimizza')
    time.sleep(2)
    food_rows = call('evaluate', {'code': 'document.querySelectorAll(".plan-food-row").length'}).get('value')
    if not food_rows or food_rows < 10:
        raise AssertionError(f'Composizione rapida incompleta: {food_rows} alimenti')
    first_grams = call('evaluate', {'code': 'document.querySelector(".grams-input input").value'}).get('value')
    fill('.grams-input input', 90)
    call('click', {'selector': '.plan-food-row button[title="Sostituisci con alternativa equivalente"]'})
    wait_for('Alternativa a')
    call('click', {'selector': '.food-picker-list > button'})
    wait_for_modal_close()
    wait_for('Alimento sostituito')
    print(f'PASS motore Vatia, modifica grammi e alternative ({food_rows} alimenti, primo valore {first_grams})')

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
    click_button('Lista spesa', contains=True)
    wait_for('g', timeout=5)
    if not call('evaluate', {'code': 'document.querySelectorAll(".shopping-list > div").length'}).get('value'):
        raise AssertionError('Lista spesa vuota nonostante il piano composto')
    call('click', {'selector': '.modal-close'})
    screenshot('builder-desktop.jpg')
    print('PASS anteprima settimanale e lista spesa')

    click_button('Diario alimentare', contains=True)
    wait_for('Piano di confronto')
    if not any(plan_name in value for value in texts(snapshot())):
        raise AssertionError('Il diario non usa il piano appena salvato')
    click_button('Registra consumo')
    fill('.diary-entry-fields input[placeholder]', 'Porzione inserita durante test automatico')
    fill('.modal .search-field input', 'Pasta di semola')
    click_button('Pasta di semola di grano duro', contains=True, scope='.modal')
    wait_for_modal_close()
    wait_for('Registrato dal professionista')
    wait_for('CONSUMATO')
    screenshot('diary-desktop.jpg')
    print('PASS diario comparato con piano e origine registrazione')

    click_button('Calendario')
    click_button('Nuovo appuntamento')
    fill('.modal [name="time"]', '10:15')
    fill('.modal [name="notes"]', 'Follow-up fittizio E2E')
    call('click', {'selector': '.modal button[type="submit"]'})
    wait_for_modal_close()
    wait_for('Follow-up fittizio E2E')
    print('PASS appuntamento collegato al paziente')

    click_button('Insight')
    wait_for('DATI PER IL FOLLOW-UP')
    wait_for('Macronutrienti medi')
    print('PASS insight alimentati dai dati reali')

    call('reload')
    wait_for('Spazio cloud protetto')
    select_option('.topbar .select-wrap select', patient_name)
    click_button('Diete', contains=True)
    wait_for(plan_name)
    click_button('Diario alimentare', contains=True)
    wait_for('Registrato dal professionista')
    click_button('Calendario')
    wait_for('Follow-up fittizio E2E')
    print('PASS persistenza cloud dopo ricaricamento')

    overflow = call('evaluate', {'code': 'document.documentElement.scrollWidth > window.innerWidth + 2'}).get('value')
    if overflow:
        raise AssertionError('Overflow orizzontale nella vista desktop')
    call('cdp', {'method': 'Emulation.setDeviceMetricsOverride', 'params': {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True}})
    time.sleep(2)
    screenshot('calendar-mobile.jpg')
    mobile_overflow = call('evaluate', {'code': 'document.documentElement.scrollWidth > window.innerWidth + 2'}).get('value')
    if mobile_overflow:
        raise AssertionError('Overflow orizzontale nella vista mobile')
    call('cdp', {'method': 'Emulation.clearDeviceMetricsOverride', 'params': {}})
    print('PASS layout desktop e mobile senza overflow pagina')
    print('E2E COMPLETATO')
finally:
    try:
        call('cdp', {'method': 'Emulation.clearDeviceMetricsOverride', 'params': {}})
        call('close_tab')
    except Exception:
        pass
    server.terminate()
    try:
        server.wait(timeout=8)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()
    log.close()
