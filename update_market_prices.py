#!/usr/bin/env python3
"""Read regional pellet reference prices and national heating-oil reference.
Only prices on pages with corroborating current-day dates are accepted.
This script is informational only; it never changes the app's purchase prices.
"""
from __future__ import annotations
import datetime as dt
import json
import re
import sys
from pathlib import Path
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
FILE = ROOT / 'market-prices.json'
HISTORY_FILE = ROOT / 'market-price-history.json'
NOW = dt.datetime.now(dt.timezone(dt.timedelta(hours=2))) # German summer time fallback below
try:
    from zoneinfo import ZoneInfo
    NOW = dt.datetime.now(ZoneInfo('Europe/Berlin'))
except Exception:
    pass
TODAY = NOW.date()

URLS = {
    'pellets_loose': 'https://www.heizpellets24.de/pelletpreise/nordrhein-westfalen/olpe/drolshagen-57489',
    'pellets_bag': 'https://www.holzpellets.net/pelletspreise/Nordrhein-Westfalen/Olpe/pellets-Drolshagen',
    'heating_oil': 'https://www.tecson.de/de/heizoelpreise.html',
}

def get_text(url):
    response = requests.get(url, timeout=30, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; VerbrauchZuhause/1.1; personal home energy dashboard)',
        'Accept-Language': 'de-DE,de;q=0.9',
    })
    response.raise_for_status()
    page = BeautifulSoup(response.text, 'html.parser')
    for el in page(['script', 'style', 'noscript']):
        el.decompose()
    return re.sub(r'\s+', ' ', page.get_text(' ', strip=True)).strip()

def euro(text):
    return float(text.replace('.', '').replace(',', '.'))

def page_has_today(text):
    # Explicit day/month/year, with either two- or four-digit year.
    for day, month, year in re.findall(r'\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b', text):
        yy = int(year) + (2000 if len(year) == 2 else 0)
        try:
            if dt.date(yy, int(month), int(day)) == TODAY:
                return True
        except ValueError:
            pass
    # TECSON market report often states 'Mittwoch, 14. Okt.' instead.
    names = 'Jan Feb Mär Apr Mai Jun Jul Aug Sep Okt Nov Dez'.split()
    month_name = names[TODAY.month - 1]
    return bool(re.search(r'\b(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),?\s*'
                          + str(TODAY.day) + r'\.\s*' + month_name + r'\.?\b', text, re.I))

def parse_prices(key, text):
    if key == 'pellets_loose':
        patterns = [
            r'Holzpelletspreise\s+für\s+lose\s+Ware\s+aktuell\s+bei\s*([\d.,]+)\s*€\s*pro\s*1[.]?000\s*kg',
            r'Holzpelletspreise\s+für\s+lose\s+Ware.{0,70}?\s+bei\s*([\d.,]+)\s*€\s*pro\s*1[.]?000\s*kg',
        ]
        factor = 1
    elif key == 'pellets_bag':
        patterns = [
            r'Der\s+Preis\s+für\s+Pellets\s+Sackware\s+in\s+Drolshagen.{0,90}?\s+aktuell\s+bei\s*([\d.,]+)\s*€\s*pro\s*Tonne',
            r'Holzpellets\s+Sackware\s+für\s+Drolshagen.{0,350}?Tonnenpreis\s*([\d.,]+)\s*€',
        ]
        factor = 1
    else:
        patterns = [
            r'Durchschnittspreis\s+heute\s+Morgen\s+auf\s*([\d.,]+)\s*Euro\s*je\s*100\s*Liter',
            r'DE[- ]Durchschnittspreis\s+bei\s*([\d.,]+)\s*EUR/Liter',
        ]
        factor = 100 if 'EUR/Liter' in text else 1
    for i, pattern in enumerate(patterns):
        match = re.search(pattern, text, flags=re.I)
        if match:
            val = euro(match.group(1))
            if key == 'heating_oil' and i == 1:
                val *= 100
            return round(val, 2)
    return None

def update():
    data = json.loads(FILE.read_text(encoding='utf-8'))
    success = 0
    confirmed = {}
    for key, url in URLS.items():
        try:
            text = get_text(url)
            if not page_has_today(text):
                print(f'{key}: kein überprüfbares heutiges Datum im Seitentext')
                continue
            price = parse_prices(key, text)
            if price is None:
                print(f'{key}: Preistext nicht gefunden (Länge {len(text)} Zeichen)')
                continue
            minimum, maximum = (100, 1500) if key.startswith('pellets') else (30, 350)
            if not minimum <= price <= maximum:
                print(f'{key}: Preis außerhalb plausiblen Bereichs: {price}')
                continue
            data['prices'][key].update(price=price, checked_at=NOW.isoformat(timespec='seconds'), source_url=url)
            success += 1
            confirmed[key] = price
            print(f'{key}: {price:.2f} {data["prices"][key]["unit"]} ({TODAY.isoformat()})')
        except Exception as err:
            print(f'{key}: Abruf fehlgeschlagen: {type(err).__name__}: {err}')
    data['generated_at'] = NOW.isoformat(timespec='seconds')
    FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    # Separate day-by-day history, retaining the last verified price for each day.
    # No fabricated points and no duplicate daily records from twice-daily runs.
    history = {'region': '57489 Drolshagen', 'records': []}
    if HISTORY_FILE.exists():
        try:
            old = json.loads(HISTORY_FILE.read_text(encoding='utf-8'))
            if isinstance(old.get('records'), list): history = old
        except (ValueError, OSError, AttributeError) as err:
            print('Warnung: bisherige Preis-Historie nicht lesbar:', err)
    if confirmed:
        date = TODAY.isoformat()
        records = [r for r in history['records'] if isinstance(r, dict)]
        current = next((r for r in records if r.get('date') == date), None)
        if current is None:
            current = {'date': date, 'checked_at': NOW.isoformat(timespec='seconds'), 'prices': {}}
            records.append(current)
        current['prices'].update(confirmed)
        current['checked_at'] = NOW.isoformat(timespec='seconds')
        history['records'] = sorted(records, key=lambda r: r.get('date', ''))
        HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'Preis-Historie aktualisiert: {date} ({len(confirmed)} verifizierte Preise)')
    print(f'Ergebnis: {success}/3 Preise bestätigt')
    # Raise explicit failure when all sources are unavailable, rather than green success with nulls.
    if success == 0:
        sys.exit('Keine aktuellen Preise bestätigt. Prüfe Quellseiten/Parser im Log.')

if __name__ == '__main__':
    update()
