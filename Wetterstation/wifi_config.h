#pragma once

// Zugangsdaten nur lokal eintragen. Nicht oeffentlich teilen.
struct WifiEntry { const char* ssid; const char* password; };

const WifiEntry WIFI_NETWORKS[] = {
  {"MAS", "HIER_HOTSPOT_PASSWORT"},
  {"FRITZ!Box 7530 OX", "HIER_PASSWORT"},
  {"TP_Link_04FC", "HIER_PASSWORT"},
  {"TP-Link_AP_FC3E", "HIER_PASSWORT"},
  {"TP_LINK_4A39B4", "HIER_PASSWORT"}
};
const size_t WIFI_COUNT = sizeof(WIFI_NETWORKS) / sizeof(WIFI_NETWORKS[0]);
