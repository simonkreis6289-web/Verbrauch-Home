# Verbrauch Zuhause

Lokale Version der App ohne Firebase-Anbindung.

## Funktionen
- Strom, Wasser und Pellets erfassen
- Datum und Uhrzeit frei auswählen
- Pellets als Sackware mit `Anzahl Säcke × kg pro Sack`
- Suche nach Art, Zeitraum und Wertebereich
- Bearbeiten und Löschen
- Grafische Darstellung
- PWA, also installierbar wie eine App
- Speicherung lokal im Browser über `localStorage`

## Starten
Einfach die Dateien auf einen Webserver legen und `index.html` öffnen.

Für lokales Testen kannst du z. B. verwenden:

```bash
python3 -m http.server 8080
```

Dann im Browser öffnen:
`http://localhost:8080`

## Hinweis
Aktuell bleiben die Daten lokal auf dem jeweiligen Gerät gespeichert.
Die Firestore-Anbindung kann später eingebaut werden, ohne das UI neu zu bauen.
