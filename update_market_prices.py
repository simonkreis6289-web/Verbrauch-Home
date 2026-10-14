#!/usr/bin/env python3
"""Update VERIFIED price references. Never mark archived data as fresh.
Requires requests and BeautifulSoup. If a website changes/blocks, retain old values
and old timestamps instead of fabricating freshness.
"""
import datetime as dt
import json
import re
from pathlib import Path
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
FILE = ROOT / 'market-prices.json'
NOW = dt.datetime.now(dt.timezone.utc)


def get_page(url):
    resp = requests.get(url, timeout=25, headers={'User-Agent':'VerbrauchZuhausePriceMonitor/1.0 (private price dashboard)', 'Accept-Language':'de-DE,de;q=0.9'})
    resp.raise_for_status()
    return BeautifulSoup(resp.text, 'html.parser').get_text(' ', strip=True)


def money(value):
    return float(value.replace('.', '').replace(',', '.'))


def fresh_publication(text):
    # The date must come from page content, not from fetch time alone.
    dates = re.findall(r'\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b', text[:4500])
    for d, m, y in dates:
        try:
            published = dt.datetime(int(y), int(m), int(d), tzinfo=dt.timezone.utc)
            if 0 <= (NOW-published).total_seconds() <= 48*3600:
                return True
        except ValueError:
            pass
    return False


def update():
    data = json.loads(FILE.read_text(encoding='utf-8'))
    sources = {
        'pellets_loose': ('https://www.heizpellets24.de/pelletpreise/nordrhein-westfalen/olpe/drolshagen-57489',
                          r'(?:in 57489 Drolshagen liegen die Holzpelletspreise für lose Ware (?:aktuell )?bei)\s*([\d.,]+)\s*€\s*pro\s*1[.]?000\s*kg'),
        'pellets_bag': ('https://www.holzpellets.net/pelletspreise/Nordrhein-Westfalen/Olpe/pellets-Drolshagen',
                        r'(?:Preis für Pellets Sackware in Drolshagen[^.]{0,160}?bei)\s*([\d.,]+)\s*€\s*pro\s*Tonne'),
        'heating_oil': ('https://www.tecson.de/de/heizoelpreise.html',
                        r'(?:bundesweite Durchschnittspreis heute Morgen auf|Durchschnittspreis heute Morgen auf)\s*([\d.,]+)\s*Euro\s*je\s*100\s*Liter')
    }
    for key,(url, pattern) in sources.items():
        try:
            text = get_page(url)
            if not fresh_publication(text):
                print(key, 'Quelle ohne bestätigten aktuellen Zeitstempel; bisherige Daten bleiben unverändert')
                continue
            hit = re.search(pattern, text, flags=re.I)
            if not hit:
                print(key, 'Preismuster fehlt; bisherige Daten bleiben unverändert')
                continue
            price = money(hit.group(1))
            minimum, maximum = (100, 1500) if key.startswith('pellets') else (30, 350)
            if not minimum <= price <= maximum:
                raise ValueError(f'Unplausibler Preis: {price}')
            data['prices'][key].update(price=price, checked_at=NOW.isoformat(timespec='seconds'), source_url=url)
            print(key, price)
        except Exception as error:
            print(key, 'Abruf fehlgeschlagen:', error)
    data['generated_at'] = NOW.isoformat(timespec='seconds')
    FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__=='__main__': update()
