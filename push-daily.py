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
        'Accept': 'application/json',
        'User-Agent': 'VerbrauchZuhause-Push/1.0 (+GitHub-Actions; personal notifications)',
    })
    try:
        with urlopen(req, timeout=25) as response:
            result = json.load(response)
    except HTTPError as e:
        raise RuntimeError(f'Push-Server HTTP {e.code}; Content-Type={e.headers.get("Content-Type", "unbekannt")}; CF-Ray={e.headers.get("CF-Ray", "unbekannt")}: {e.read().decode("utf-8", "replace")[:300]}') from e
    print('Push:', title, result)
    if not result.get('ok', False) or result.get('failed', 0):
        raise RuntimeError('Nicht alle angemeldeten Geräte wurden erreicht')


def load_rules():
    payload=json.dumps({'household':household}).encode('utf-8')
    req=Request(endpoint+'/settings/get',data=payload,method='POST',headers={
        'Authorization':'Bearer '+secret,'Content-Type':'application/json','Accept':'application/json',
        'User-Agent':'VerbrauchZuhause-Push/1.0 (+GitHub-Actions; personal notifications)'})
    with urlopen(req,timeout=25) as response:
        settings=json.load(response)
    if not settings.get('ok') or not isinstance(settings.get('rules'),dict):
        raise RuntimeError('Push-Regeln konnten nicht sicher geladen werden')
    return settings['rules']

def price_text():
    """Nur Preise, die HEUTE und nach dem vorgesehenen Tagesabruf bestaetigt wurden.

    Bei Ausfall der Preisabfrage versendet der Job keine alten Preiswerte.
    """
    data = json.loads(Path('market-prices.json').read_text(encoding='utf-8'))
    prices = data.get('prices', {})
    snippets = []
    # Auch bei manuell gestartetem Job den letzten geplanten Abruf als Grenze nutzen.
    check_hour, check_minute = (17, 0) if now.hour >= 17 else (6, 45)
    cutoff = now.replace(hour=check_hour, minute=check_minute, second=0, microsecond=0)
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
            checked_local = checked.astimezone(BERLIN)
            if not cutoff <= checked_local <= now:
                print(f'{key}: Keine Bestaetigung seit {cutoff:%H:%M} Uhr, weggelassen.')
                continue
        except (ValueError, AttributeError):
            continue
        formatted = f'{value:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
        snippets.append(f'{label}: {formatted} {unit}')
    return ' · '.join(snippets) if snippets else None

# Test: morgens 06:48 und abends 17:15; nur fuer diesen Abruf bestaetigte Preise.
rules=load_rules()
text = price_text() if rules.get('prices',True) and now.hour in (6, 17) else None
if text:
    send('Energiepreise · ' + now.strftime('%d.%m.%Y'), text)
else:
    print('Preise deaktiviert oder seit dem geplanten Abruf keine frisch bestätigten Preise. Kein Push gesendet.')

# Monatsende-Erinnerung nur am ABEND, nicht doppelt um 10:15 und 17:15.
if now.hour == 17 and rules.get('reminder',True) and (now + timedelta(days=1)).month != now.month:
    send('Monatsende · Zählerstände erfassen', 'Bitte Strom, Wasser und Pellets ablesen und in Verbrauch Zuhause eintragen.')
