Wetterstation 01 - JSON-Adresse als Laufschrift

1. Ordner in Arduino IDE oeffnen, Wetterstation_01.ino starten.
2. In wifi_config.h deine WLAN-Passwoerter lokal eintragen.
3. TFT Hochkant; die unterste Zeile zeigt fortlaufend http://<IP>/api/status.
4. Bei WLAN-Wechsel wird die Adresse automatisch aktualisiert.
5. Sensoren, JSON-Endpunkt und 10-Minuten-Messtakt bleiben unveraendert.

Benutzte Bibliotheken: DHT sensor library (Adafruit), Adafruit GFX, Adafruit ST7735/ST7789.
Board: LOLIN(WEMOS) D1 R2 & mini.
