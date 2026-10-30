import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / 'test-artifacts'
ARTIFACTS.mkdir(exist_ok=True)
SESSION = 'vatia-product-audit'


def call(action, args=None):
    payload = {'action': action, 'args': args or {}, 'session': SESSION}
    request = urllib.request.Request('http://127.0.0.1:10086/command', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    result = json.load(urllib.request.urlopen(request, timeout=45))
    if not result.get('ok'):
        raise RuntimeError(f'{action}: {result}')
    return result.get('data', {})


def evaluate(code):
    return call('evaluate', {'code': code}).get('value')


def click(name):
    result = evaluate('(()=>{const b=Array.from(document.querySelectorAll("button")).find(x=>x.offsetParent!==null&&x.innerText.includes(' + json.dumps(name) + '));if(!b)return false;b.click();return true})()')
    if not result:
        raise AssertionError(f'Pulsante non trovato: {name}; ' + evaluate('document.body.innerText'))
    time.sleep(1)


def screenshot(name):
    call('screenshot', {'format': 'jpeg', 'quality': 85, 'path': str(ARTIFACTS / name)})


call('navigate', {'url': 'http://127.0.0.1:7100/Vatia-v2/', 'newTab': True})
time.sleep(3)
evaluate('localStorage.clear();true')
call('reload')
time.sleep(3)
click('Accedi come ospite')
click('Esplora con dati demo')
time.sleep(2)
screenshot('new-dashboard.jpg')
for nav, image in [('Monitoraggio', 'new-monitoring.jpg'), ('Agenda', 'new-agenda.jpg'), ('Fatturazione', 'new-billing.jpg'), ('Insight di studio', 'new-insights.jpg')]:
    click(nav)
    time.sleep(2)
    screenshot(image)
    body = evaluate('document.body.innerText')
    if 'NaN' in body:
        raise AssertionError(f'NaN in {nav}')
    errors = evaluate('Array.from(document.querySelectorAll(".workspace-error")).filter(x=>x.offsetParent!==null).map(x=>x.innerText)')
    if errors:
        raise AssertionError(f'Errori in {nav}: {errors}')
    print('PASS', nav)
call('close_tab')
