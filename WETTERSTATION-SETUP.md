# Wetterstationen v124 – Einrichtung

## Enthalten

- Wetter-Kachel zwischen Kopf und Hauptnavigation, ausgeblendet ohne aktive Station.
- Stationen manuell wählen und automatischer Wechsel alle acht Sekunden.
- Wetter-Reiter mit Temperatur-, Feuchte- und Helligkeitsdiagrammen.
- Einstellungen → Wetterstationen: Anlegen, Aktivieren, Benennen, Grenzwerte, Morgenbericht und Ausfallwarnungen.
- Entfernte Kamera-/OCR-Funktion, manuelle Zählerstände bleiben erhalten.
- Cloudflare-Worker: authentifizierte Messwertannahme, Speicherung, Abfrage, Grenzwert- und Push-Auswertung.
- Keine Bosch-Smart-Home-Anbindung.

## Inbetriebnahme (erforderlich)

1. `cloudflare-worker.js` als neue Version des **bestehenden** Workers `verbrauch-push` veröffentlichen. Die bisherigen Bindings und Secrets (`PUSH_DEVICES`, `PUSH_SECRET`, FCM-Variablen, Cron) beibehalten. Vorhandenen Worker vor dem Ersetzen sichern.
2. Die App-Dateien aus diesem ZIP ins bestehende GitHub-Repository übernehmen. `weather.js` muss neben `index.html` liegen. Der Service-Worker-Cache wurde erhöht.
3. App öffnen, **Einstellungen → Wetterstationen**. Den vorhandenen Push-Zugangscode eingeben und auf „Stationen laden“ klicken.
4. Station `WS-01` anlegen. Den **einmalig angezeigten Stationsschlüssel** sicher aufbewahren. Er wird nicht im Browser gespeichert.
5. Die ESP8266-Firmware anschließend erweitern: Alle zehn Minuten per HTTPS POST an `https://verbrauch-push.simonkreis6289.workers.dev/weather/ingest` senden. Header `Authorization: Bearer <Stationsschlüssel>` und `Content-Type: application/json`.

Beispiel für den Request-Body (Messwerte nur als Beispiel):

```json
{"household":"zuhause-haupt","id":"WS-01","temperatureC":22.4,"humidityPercent":51,"brightnessPercent":47}
```

Der tatsächliche Haushalt ist die interne Haushalts-ID aus der App (nicht der Anzeigename). Die Firmware muss einen verifizierten HTTPS-Client benutzen. **Keine TLS-Zertifikatsprüfung abschalten.**

## Wichtige Grenzen

- **Ohne Worker-Deployment und Firmware-Anpassung kommen noch keine Live-Messungen an.** Die App kann diese nicht selbst im Hintergrund aus dem privaten WLAN abholen.
- Die 10-Minuten-Aufzeichnung ist als **Push von der Station** ausgelegt. Bei WLAN-Ausfall werden Messungen in dieser Version noch **nicht** lokal zwischengespeichert. Das ist ein separater Firmware-Schritt.
- Die Wetterhistorie liegt in Cloudflare KV (je Messung ein Schlüssel, Aufbewahrung 366 Tage). Die History-Abfrage listet Schlüssel und liest jeden einzeln. Bei vielen Stationen ist dafür langfristig **D1** sinnvoller. Die Jahresansicht ist zunächst auf 15.000 aufgelistete Schlüssel begrenzt.
- Push-Regeln werden im bestehenden 5-Minuten-Cron geprüft. Die Morgenübersicht startet gegen 07:00 Uhr Berliner Zeit und umfasst vorerst die letzten 36 Stunden. Der Grenzwertvergleich nutzt 0,5 °C bzw. 2 Prozentpunkte Rückkehrabstand, um Flattern zu vermeiden.
- Der Push-Zugangscode wird nur in `sessionStorage` gespeichert und bei Schließen des Browser-Tabs gelöscht. Der ESP hat einen **eigenen Stationsschlüssel**, nicht den Push-Admincode.
- Noch kein Test gegen eine echte Cloudflare-Installation oder die ESP-Firmware erfolgt. Vor Produktivbetrieb bitte den Worker in einer Testumgebung prüfen.
