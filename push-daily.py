"""Automatische Push-Nachrichten für den Haushalt. Keine Zugangsdaten im Code."""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo('Europe/Berlin')
now = datetime.now(BERLIN)
endpoint = os.getenv('PUSH_ENDPOINT', 'https://verbrauch-push.simonkreis6289.workers.dev').rstrip('/')
secret = os.getenv('PUSH_SECRET', '')
household = os.getenv('PUSH_HOUSEHOLD_ID', '')
if not secret or not household:
    sys.exit('PUSH_SECRET und PUSH_HOUSEHOLD_ID fehlen. GitHub-Repository-Secrets konfigurieren.')

def send(title, body):
    payload = json.dumps({'household': household, 'title': title, 'body': body}, ensure_ascii=False).encode('utf-8')
    req = Request(endpoint + '/broadcast', data=payload, method='POST', headers={
        'Authorization': 'Bearer ' + secret,
        'Content-Type': 'application/json; charset=utf-8',
    })
    try:
        with urlopen(req, timeout=25) as response:
            result = json.load(response)
    except HTTPError as e:
        raise RuntimeError(f'Push-Server HTTP {e.code}: {e.read().decode("utf-8", "replace")[:250]}') from e
    print('Push:', title, result)
    if not result.get('ok', False) or result.get('failed', 0):
        raise RuntimeError('Nicht alle angemeldeten Geräte wurden erreicht')


def price_text():
    data = json.loads(Path('market-prices.json').read_text(encoding='utf-8'))
    prices = data.get('prices', {})
    snippets = []
    for key, label, unit in [
        ('pellets_loose', 'Pellets lose', '€/t'),
        ('pellets_bag', 'Sackware', '€/t'),
        ('heating_oil', 'Heizöl', '€/100 l')
    ]:
        entry = prices.get(key, {})
        value = entry.get('price')
        if not isinstance(value, (float, int)) or not 0 < value < 10000:
            continue
        checked_at = entry.get('checked_at')
        try:
            checked = datetime.fromisoformat(checked_at.replace('Z', '+00:00'))
            if checked.tzinfo is None:
                continue
            if now.astimezone(timezone.utc) - checked.astimezone(timezone.utc) > timedelta(hours=36):
                continue
        except (ValueError, AttributeError):
            continue
        formatted = f'{value:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
        snippets.append(f'{label}: {formatted} {unit}')
    if not snippets:
        return None
    return ' · '.join(snippets)

# Aus GitHub Actions einmal am Tag starten; nur bestätigte, frische Preise senden.
text = price_text()
if text:
    send('Energiepreise · ' + now.strftime('%d.%m.%Y'), text)
else:
    print('Keine bestätigten Preise jünger als 36 Stunden. Kein Push gesendet.')

# Der Job läuft täglich, die Erinnerung wird nur am letzten Monatstag versandt.
if (now + timedelta(days=1)).month != now.month:
    send('Monatsende · Zählerstände erfassen', 'Bitte Strom, Wasser und Pellets ablesen und in Verbrauch Zuhause eintragen.')
