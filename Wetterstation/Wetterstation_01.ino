#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DHT.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include "wifi_config.h"

// Pins ggf. an deinen bereits funktionierenden Aufbau anpassen.
#define DHT_PIN D2
#define DHT_TYPE DHT11
#define LDR_PIN A0
#define LED_PIN D1
#define TFT_CS D8
#define TFT_DC D3
#define TFT_RST D4
#define TFT_ENABLED 1  // 0 = TFT nicht angeschlossen

const char* STATION_ID = "WS-01";
const unsigned long SENSOR_INTERVAL_MS = 10000UL; // TFT-/Livewerte alle 10 Sekunden
const unsigned long LOG_INTERVAL_MS = 600000UL;   // 10-Minuten-Messintervall
const unsigned long WIFI_RETRY_MS = 20000UL;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 9000UL;

DHT dht(DHT_PIN, DHT_TYPE);
ESP8266WebServer server(80);
#if TFT_ENABLED
Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);
#endif

float temperature = NAN;
float humidity = NAN;
int lightRaw = 0;
int lightPercent = 0;
unsigned long lastRead = 0;
unsigned long lastLog = 0;
unsigned long lastWifiAttempt = 0;
unsigned long wifiStarted = 0;
int selectedNetwork = -1;
bool wifiConnecting = false;
bool hasRead = false;
// JSON-Adresse im TFT-Fuss als Laufschrift (20 Zeichen bei Textgroesse 1).
const unsigned long MARQUEE_INTERVAL_MS = 260UL;
unsigned long lastMarqueeStep = 0;
size_t marqueePosition = 0;
String marqueeText = "";
String previousMarqueeText = "";


String jsonNumber(float n, int decimals) {
  return isnan(n) ? "null" : String(n, decimals);
}

String jsonEscape(const String& input) {
  String out;
  for (unsigned int i = 0; i < input.length(); i++) {
    char c = input[i];
    if (c == '\\' || c == '"') { out += '\\'; out += c; }
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if ((uint8_t)c >= 32) out += c;
  }
  return out;
}

void readSensors() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) temperature = t;
  if (!isnan(h)) humidity = h;
  lightRaw = analogRead(LDR_PIN);
  lightPercent = constrain((int)round(lightRaw * 100.0 / 1023.0), 0, 100);
  lastRead = millis();
  hasRead = true;
}

void drawDisplay() {
#if TFT_ENABLED
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextWrap(false);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_CYAN);
  tft.setCursor(4, 6); tft.print("WETTERSTATION 01");
  tft.drawFastHLine(4, 20, 120, ST77XX_CYAN);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(5, 28); tft.print("TEMPERATUR");
  tft.setTextSize(2); tft.setTextColor(ST77XX_YELLOW);
  tft.setCursor(5, 41);
  if (isnan(temperature)) tft.print("--.- C");
  else { tft.print(temperature, 1); tft.print(" C"); }
  tft.drawFastHLine(4, 65, 120, ST77XX_BLUE);
  tft.setTextSize(1); tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(5, 72); tft.print("LUFTFEUCHTIGKEIT");
  tft.setTextSize(2); tft.setTextColor(ST77XX_CYAN);
  tft.setCursor(5, 85);
  if (isnan(humidity)) tft.print("-- %");
  else { tft.print(humidity, 0); tft.print(" %"); }
  tft.drawFastHLine(4, 108, 120, ST77XX_BLUE);
  tft.setTextSize(1); tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(5, 115); tft.print("HELLIGKEIT");
  tft.setTextSize(2); tft.setTextColor(ST77XX_GREEN);
  tft.setCursor(5, 128); tft.print(lightPercent); tft.print(" %");
  // Fusszeile wird separat aktualisiert, damit sie scrollen kann.
#endif
}

void updateAddressMarquee() {
#if TFT_ENABLED
  String address;
  if (WiFi.status() == WL_CONNECTED) {
    address = "http://" + WiFi.localIP().toString() + "/api/status";
  } else {
    address = "WLAN nicht verbunden";
  }
  // Leerzeichen an beiden Enden machen den Durchlauf lesbarer.
  marqueeText = "   " + address + "      ";
  if (marqueeText != previousMarqueeText) {
    marqueePosition = 0;
    previousMarqueeText = marqueeText;
    lastMarqueeStep = 0;
  }
  if (lastMarqueeStep != 0 && millis() - lastMarqueeStep < MARQUEE_INTERVAL_MS) return;
  lastMarqueeStep = millis();
  tft.fillRect(0, 146, 128, 14, ST77XX_BLACK);
  tft.drawFastHLine(4, 145, 120, ST77XX_BLUE);
  tft.setTextSize(1);
  tft.setTextWrap(false);
  tft.setTextColor(WiFi.status() == WL_CONNECTED ? ST77XX_GREEN : ST77XX_RED);
  tft.setCursor(3, 150);
  String visible;
  for (int i = 0; i < 20; ++i) {
    visible += marqueeText[(marqueePosition + i) % marqueeText.length()];
  }
  tft.print(visible);
  marqueePosition = (marqueePosition + 1) % marqueeText.length();
#endif
}

void blinkMeasurement() {
  digitalWrite(LED_PIN, HIGH);
  delay(70);
  digitalWrite(LED_PIN, LOW);
}

void logMeasurement() {
  blinkMeasurement();
  Serial.printf("[10-MIN] %s | T=%s C | RH=%s %% | Licht=%d %% (%d)\n",
    STATION_ID, jsonNumber(temperature, 1).c_str(),
    jsonNumber(humidity, 1).c_str(), lightPercent, lightRaw);
  // Spaeter: gesicherte Uebertragung an Cloudflare/Firestore.
}

void beginBestWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.disconnect();
  delay(50);
  int found = WiFi.scanNetworks(false, true);
  int best = -1;
  int bestRssi = -1000;
  for (int i = 0; i < found; i++) {
    for (size_t j = 0; j < WIFI_COUNT; j++) {
      if (WiFi.SSID(i) == WIFI_NETWORKS[j].ssid &&
          String(WIFI_NETWORKS[j].password).length() > 0 &&
          strncmp(WIFI_NETWORKS[j].password, "HIER_", 5) != 0 &&
          WiFi.RSSI(i) > bestRssi) {
        best = (int)j;
        bestRssi = WiFi.RSSI(i);
      }
    }
  }
  WiFi.scanDelete();
  if (best >= 0) {
    selectedNetwork = best;
    Serial.printf("Verbinde mit %s (%d dBm)\n", WIFI_NETWORKS[best].ssid, bestRssi);
    WiFi.begin(WIFI_NETWORKS[best].ssid, WIFI_NETWORKS[best].password);
    wifiStarted = millis();
    wifiConnecting = true;
  } else {
    Serial.println("Kein bekanntes WLAN gefunden.");
    wifiConnecting = false;
  }
}

void handleWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiConnecting) {
      Serial.printf("WLAN verbunden: %s | IP: %s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
      wifiConnecting = false;
      drawDisplay();
    }
    return;
  }
  if (wifiConnecting) {
    if (millis() - wifiStarted < WIFI_CONNECT_TIMEOUT_MS) return;
    Serial.println("WLAN-Verbindung fehlgeschlagen; neuer Versuch spaeter.");
    WiFi.disconnect();
    wifiConnecting = false;
    drawDisplay();
  }
  if (lastWifiAttempt == 0 || millis() - lastWifiAttempt >= WIFI_RETRY_MS) {
    lastWifiAttempt = millis();
    beginBestWifi();
  }
}

void handleStatus() {
  String json = "{";
  json += "\"stationId\":\"" + String(STATION_ID) + "\",";
  json += "\"temperatureC\":" + jsonNumber(temperature, 1) + ",";
  json += "\"humidityPercent\":" + jsonNumber(humidity, 1) + ",";
  json += "\"brightnessPercent\":" + String(lightPercent) + ",";
  json += "\"brightnessRaw\":" + String(lightRaw) + ",";
  json += "\"wifiSsid\":\"" + jsonEscape(WiFi.SSID()) + "\",";
  json += "\"rssiDbm\":" + String(WiFi.RSSI()) + ",";
  json += "\"uptimeSeconds\":" + String(millis() / 1000UL) + ",";
  json += "\"lastReadAgeSeconds\":" + String((millis() - lastRead) / 1000UL);
  json += "}";
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json; charset=utf-8", json);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  dht.begin();
#if TFT_ENABLED
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(0); // Hochkant
#endif
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.hostname("wetterstation-01");
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/", HTTP_GET, []() {
    server.send(200, "text/plain; charset=utf-8", "Wetterstation 01: /api/status");
  });
  server.begin();
  readSensors();
  drawDisplay();
  updateAddressMarquee();
  lastLog = millis();
  beginBestWifi();
  lastWifiAttempt = millis();
  Serial.println("Wetterstation 01 gestartet");
}

void loop() {
  handleWifi();
  server.handleClient();
  updateAddressMarquee();
  if (millis() - lastRead >= SENSOR_INTERVAL_MS) {
    readSensors();
    drawDisplay();
  }
  if (millis() - lastLog >= LOG_INTERVAL_MS) {
    lastLog = millis();
    readSensors();
    logMeasurement();
    drawDisplay();
  }
  yield();
}
