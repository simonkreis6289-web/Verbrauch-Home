#!/usr/bin/env python3
"""Bundesweite Super-E5-/E10-/Dieselpreise, maximal 3 Jahre Historie.
Nur bundesweite Werte der Benzinpreis-Aktuell-API, niemals Standortdaten.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
SOURCE = 'https://www.benzinpreis-aktuell.de/api.v2.php?data=nationwide'
LATEST = ROOT / 'fuel-prices.json'
HISTORY = ROOT / 'fuel-price-history.json'
ZONE = ZoneInfo('Europe/Berlin')

def build(now, payload, history):
    raw_date = str(payload['date'])
    source_time = datetime.strptime(raw_date, '%Y-%m-%d %H:%M:%S').replace(tzinfo=ZONE).astimezone(timezone.utc)
    if source_time > now + timedelta(minutes=10):
        raise ValueError('Quellenzeitstempel liegt in der Zukunft')
    if now - source_time > timedelta(hours=2):
        raise ValueError('API meldet veraltete Werte: ' + raw_date)
    prices = {key: round(float(payload[key]), 3) for key in ('super', 'e10', 'diesel')}
    if not all(0.5 <= val <= 5.0 for val in prices.values()):
        raise ValueError('Unplausible Kraftstoffpreise')
    source_iso = source_time.isoformat().replace('+00:00', 'Z')
    fetched_iso = now.isoformat().replace('+00:00', 'Z')
    latest = {'source':SOURCE, 'source_date':source_iso, 'fetched_at':fetched_iso, 'prices':prices}
    cutoff = now - timedelta(days=3 * 365 + 1)
    records = [r for r in history.get('records', [])
               if r.get('source_date') and datetime.fromisoformat(r['source_date'].replace('Z','+00:00')) >= cutoff]
    # Keine mehrfachen Messungen desselben Quellzeitstempels
    records = [r for r in records if r['source_date'] != source_iso]
    records.append({'source_date':source_iso, 'fetched_at':fetched_iso, 'prices':prices})
    records.sort(key=lambda r:r['source_date'])
    return latest, {'source':SOURCE, 'retention_years':3, 'records':records}

def main():
    now=datetime.now(timezone.utc)
    req=Request(SOURCE,headers={'User-Agent':'Verbrauch-Zuhause-Personal/1.0','Accept':'application/json'})
    with urlopen(req,timeout=25) as response:
        payload=json.load(response)
    historical=json.loads(HISTORY.read_text(encoding='utf-8')) if HISTORY.exists() else {'records':[]}
    latest,hist=build(now,payload,historical)
    LATEST.write_text(json.dumps(latest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    HISTORY.write_text(json.dumps(hist,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print('Erfolgreich: '+latest['source_date']+', '+str(len(hist['records']))+' Historienwerte')

if __name__=='__main__':main()
