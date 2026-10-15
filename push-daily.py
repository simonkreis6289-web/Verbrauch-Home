"""Zweimal täglich Preis-Push mit Vergleichswert und Prüfzeitstempel.

Benötigt GitHub Secrets PUSH_SECRET und PUSH_HOUSEHOLD_ID.
Alte Preise sind zulässig, werden aber als ALT gekennzeichnet.
"""
import json
import os
import sys
from datetime import datetime, timedelta
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
    sys.exit('PUSH_SECRET und PUSH_HOUSEHOLD_ID fehlen. GitHub-Secrets prüfen.')


def send(title, body):
    """Der existierende Cloudflare Worker begrenzt den Push-Text auf 180 Zeichen."""
    if len(body) > 180:
        raise RuntimeError(f'Push-Nachricht zu lang ({len(body)} Zeichen > 180)')
    payload = json.dumps({'household': household, 'title': title, 'body': body}, ensure_ascii=False).encode('utf-8')
    request = Request(endpoint + '/broadcast', data=payload, method='POST', headers={
        'Authorization': 'Bearer ' + secret,
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json',
        'User-Agent': 'VerbrauchZuhause-Push/1.0 (+GitHub-Actions; personal notifications)',
    })
    try:
        with urlopen(request, timeout=25) as response:
            result = json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f'Push-Server HTTP {exc.code}; CF-Ray={exc.headers.get("CF-Ray", "unbekannt")}: {exc.read().decode("utf-8", "replace")[:300]}') from exc
    print('Push:', title, '·', body.replace('\n', ' | '), '·', result)
    if not result.get('ok', False) or result.get('failed', 0):
        raise RuntimeError('Mindestens ein registriertes Gerät nicht erreicht')


def load_rules():
    payload = json.dumps({'household': household}).encode('utf-8')
    request = Request(endpoint + '/settings/get', data=payload, method='POST', headers={
        'Authorization': 'Bearer ' + secret,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'VerbrauchZuhause-Push/1.0 (+GitHub-Actions; personal notifications)',
    })
    with urlopen(request, timeout=25) as response:
        settings = json.load(response)
    if not settings.get('ok') or not isinstance(settings.get('rules'), dict):
        raise RuntimeError('Push-Regeln konnten nicht sicher geladen werden')
    return settings['rules']


def parse_time(value):
    try:
        date = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return date.astimezone(BERLIN) if date.tzinfo else None
    except (ValueError, TypeError, OverflowError):
        return None


def amount(value):
    return f'{value:.2f}'.replace('.', ',')


CATEGORIES = [
    ('pellets_loose', 'Lose'),
    ('pellets_bag', 'Sack'),
    ('heating_oil', 'Öl'),
]


def price_text(prices_path=Path('market-prices.json'), snapshots_path=Path('market-price-snapshots.json')):
    """Stand mit Datum/Uhrzeit der *Prüfung*, plus Differenz zur vorherigen Bestätigung.

    Auch bei fehlgeschlagenem Abruf wird der letzte bekannte Preis gezeigt,
    deutlich mit ALT markiert. Nicht behaupten, es sei der Anbieter-Veröffentlichungszeitpunkt.
    """
    raw = json.loads(prices_path.read_text(encoding='utf-8'))
    prices = raw.get('prices', {})
    records = []
    if snapshots_path.exists():
        snapshots = json.loads(snapshots_path.read_text(encoding='utf-8'))
        records = [r for r in snapshots.get('records', []) if isinstance(r, dict) and parse_time(r.get('checked_at'))]
        records.sort(key=lambda r: parse_time(r['checked_at']))
    slot_hour = 17 if now.hour >= 17 else 10
    cutoff = now.replace(hour=slot_hour, minute=0, second=0, microsecond=0)
    lines = []
    for key, label in CATEGORIES:
        entry = prices.get(key) or {}
        value = entry.get('price')
        if not isinstance(value, (int, float)) or not 0 < value < 10000:
            lines.append(f'{label}: kein Preis')
            continue
        stamp = parse_time(entry.get('checked_at'))
        if stamp is None:
            lines.append(f'{label}: {amount(value)} (Stand unbekannt)')
            continue
        # Vergleich: letzter anderer bestätigter Abruf VOR der aktuellen Bestätigung.
        previous = None
        for record in reversed(records):
            t = parse_time(record['checked_at'])
            old = (record.get('prices') or {}).get(key)
            if t and t < stamp and isinstance(old, (int, float)):
                previous = old
                break
        change = 'k.V.' if previous is None else ('±0,00' if value == previous else f'{value - previous:+.2f}'.replace('.', ','))
        fresh = cutoff <= stamp <= now
        mark = '' if fresh else ' ALT'
        date_label = stamp.strftime('%d.%m.%y %H:%M')
        lines.append(f'{label}: {amount(value)} ({change}) {date_label}{mark}')
    # Einheiten ausdrücklich im Titel; keine irreführende Herkunftszeit behaupten.
    body = '\n'.join(lines)
    return body


rules = load_rules()
if rules.get('prices', True) and now.hour in (10, 17):
    text = price_text()
    send('Preise €/t · Öl €/100l · geprüft', text)
else:
    print('Preis-Push deaktiviert oder außerhalb des vorgesehenen Sendezeitfensters.')

# Monatsende: nur einmal am Abend.
if now.hour == 17 and rules.get('reminder', True) and (now + timedelta(days=1)).month != now.month:
    send('Monatsende · Zählerstände erfassen', 'Bitte Strom, Wasser und Pellets ablesen und in Verbrauch Zuhause eintragen.')
