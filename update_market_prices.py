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
    'pellets_loose': 'https://www.holzpellets.net/pelletspreise/',
    'pellets_bag': 'https://www.holzpellets.net/pelletspreise/',
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
    # Soft hyphens in TECSON headings otherwise break exact report parsing.
    clean = page.get_text(' ', strip=True).replace('\u00ad', '').replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', clean).strip()

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

def verify_pellet_date(text):
    # Important: use the date attached to the pellet market's price report,
    # not any unrelated news date elsewhere on the page.
    m = re.search(r'Stand\s*:\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*,\s*\d{1,2}:\d{2}\s*Uhr', text, re.I)
    if not m:
        return False
    try:
        return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) == TODAY
    except ValueError:
        return False


def verify_oil_date(text):
    # The current TECSON market report has a heading of the form
    # 'Heizölpreis: Ölmarktinfos Donnerstag, 15. Oktober'.
    months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
              'August', 'September', 'Oktober', 'November', 'Dezember']
    month = months[TODAY.month - 1]
    report_date = r'Heiz\s*öl\s*preis\s*:\s*Ölmarkt\s*infos\s*\w+\s*,?\s*' + str(TODAY.day) + r'\.\s*' + month + r'\b'
    return bool(re.search(report_date, text, re.I))


def parse_pellets(text):
    # Read both values from one tightly scoped, authoritative headline.
    m = re.search(
        r'Der Preis für lose Holzpellets beträgt heute im Bundesdurchschnitt\s*'
        r'([\d.,]+)\s*€\s*pro Tonne\.\s*'
        r'Eine Tonne Holzpellets Sackware kostet derzeit\s*([\d.,]+)\s*€',
        text, re.I)
    return (euro(m.group(1)), euro(m.group(2))) if m else None


def parse_heating_oil(text):
    # TECSON states the *current* DE mean in cents per litre; the same
    # numerical amount is EUR per 100 litres (176.6 ct/l => 176.6 EUR/100l).
    m = re.search(r'DE[-\s]*Durchschnittspreis\s+bei\s*([\d.,]+)\s*(?:Cent|ct)\s*/\s*Liter', text, re.I)
    if not m:
        m = re.search(r'bundesweite Durchschnittspreis heute Morgen bei\s*([\d.,]+)\s*Cent pro Liter', text, re.I)
    return euro(m.group(1)) if m else None


def update():
    data = json.loads(FILE.read_text(encoding='utf-8'))
    success = 0
    confirmed = {}
    # One request per source (the two pellet categories share one page).
    for url in dict.fromkeys(URLS.values()):
        keys = [key for key, source in URLS.items() if source == url]
        try:
            text = get_text(url)
            if 'heating_oil' in keys:
                if not verify_oil_date(text):
                    print('heating_oil: kein heutiger TECSON-Marktbericht nachweisbar')
                    continue
                readings = {'heating_oil': parse_heating_oil(text)}
            else:
                if not verify_pellet_date(text):
                    print('pellets: kein heutiger Preisstand mit Datum/Uhrzeit nachweisbar')
                    continue
                values = parse_pellets(text)
                if not values:
                    print('pellets: beide Preise im Marktbericht nicht gefunden')
                    continue
                readings = {'pellets_loose': values[0], 'pellets_bag': values[1]}
            for key, price in readings.items():
                if price is None:
                    print(f'{key}: keine gültige Preisangabe erkannt')
                    continue
                minimum, maximum = (100, 1500) if key.startswith('pellets') else (30, 350)
                if not minimum <= price <= maximum:
                    print(f'{key}: unplausibler Preis: {price}')
                    continue
                entry = data.setdefault('prices', {}).setdefault(key, {})
                entry.update(price=round(price, 2), checked_at=NOW.isoformat(timespec='seconds'),
                             source_url=url, scope='national')
                success += 1
                confirmed[key] = round(price, 2)
                print(f'{key}: {price:.2f} {entry.get("unit", "")} (DE-Durchschnitt, {TODAY.isoformat()})')
        except Exception as err:
            print(f'{", ".join(keys)}: Abruf fehlgeschlagen: {type(err).__name__}: {err}')
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
