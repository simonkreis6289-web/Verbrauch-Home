#!/usr/bin/env python3
"""Fetch the official Alperscheid calendar; keep the previous file on failure."""
import json, re, urllib.request
from pathlib import Path
from datetime import datetime, timezone, date
from zoneinfo import ZoneInfo

SOURCE = 'https://drolshagen.abfuhrtermine.info/dates/exportDates/1/Ics'
TARGET = Path(__file__).with_name('waste-calendar.json')

def parse_ics(raw):
    raw = re.sub(r'\r?\n[ \t]', '', raw)
    if 'BEGIN:VCALENDAR' not in raw or 'END:VCALENDAR' not in raw:
        raise ValueError('Invalid calendar')
    events = set()
    for block in re.findall(r'BEGIN:VEVENT\s*(.*?)END:VEVENT', raw, re.S):
        start = re.search(r'^DTSTART(?:;[^:\r\n]*)?:(\d{8})', block, re.M)
        summary = re.search(r'^SUMMARY(?:;[^:\r\n]*)?:(.+)', block, re.M)
        if not start or not summary:
            continue
        day = datetime.strptime(start[1], '%Y%m%d').date().isoformat()
        label = re.sub(r'\\([,;\\])', r'\1', summary[1].strip()).replace('\\n', ' ')
        events.add((day, label))
    if not events:
        raise ValueError('Empty calendar')
    return [{'date': d, 'label': s} for d, s in sorted(events)]

def kind(label):
    s = label.lower()
    if re.search(r'braun|bioabfall|biotonne|biomüll', s): return 'bio'
    if re.search(r'grau|schwarz|restabfall|restmüll', s) and 'sperr' not in s: return 'rest'
    if re.search(r'gelb|wertstoff|leichtverpack', s): return 'yellow'
    if re.search(r'grüne? tonne|grün.*tonne|papier|pappe', s): return 'paper'
    return 'special'

def main():
    req = urllib.request.Request(SOURCE, headers={'User-Agent': 'Verbrauch-Zuhause/1.0', 'Accept': 'text/calendar'})
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read(4_000_001).decode('utf-8-sig')
    if len(raw) > 4_000_000: raise ValueError('Calendar too large')
    events = parse_ics(raw)
    today = datetime.now(ZoneInfo('Europe/Berlin')).date().isoformat()
    if not any(e['date'] >= today for e in events): raise ValueError('No upcoming events')
    for e in events: e['kind'] = kind(e['label'])
    # The upstream export can drop today's collections before midnight.
    # Preserve previously confirmed collections for the current Berlin date only.
    if TARGET.exists():
        previous = json.loads(TARGET.read_text(encoding='utf-8'))
        if previous.get('source') == SOURCE and previous.get('location') == 'Drolshagen-Alperscheid':
            keys = {(e['date'], e['kind'], e['label'] if e['kind'] == 'special' else '') for e in events}
            for e in previous.get('events', []):
                key = (e['date'], e['kind'], e['label'] if e['kind'] == 'special' else '')
                if e['date'] == today and key not in keys:
                    events.append(e)
                    keys.add(key)
    events.sort(key=lambda e: (e['date'], e['label']))
    if not {'bio','rest','yellow','paper'}.issubset({e['kind'] for e in events}):
        raise ValueError('Missing regular collection categories; check source format')
    result = {'source': SOURCE, 'location': 'Drolshagen-Alperscheid', 'updatedAt': datetime.now(timezone.utc).isoformat(), 'events': events}
    tmp = TARGET.with_suffix('.tmp')
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    tmp.replace(TARGET)

if __name__ == '__main__': main()
