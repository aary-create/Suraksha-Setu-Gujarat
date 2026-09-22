/*
  Suraksha Setu — ESP32 Local Node
  ----------------------------------
  A battery/solar-friendly beacon that keeps the latest disaster alert
  available on a local WiFi network, even when the internet is down.

  What it does:
   - Every FETCH_INTERVAL_MS, if it has internet, it calls the website's
     /api/esp32-sync with this node's fixed lat/lng and gets back the
     current alert for that exact spot (real IMD/SACHET data).
   - It saves that alert to flash (LittleFS), so a reboot or power cut
     doesn't lose it.
   - It also keeps the last 5 days of *changes* to the alert in flash
     (/history.json) — same 5-day retention policy as the phone app.
   - It broadcasts the alert over ESP-NOW to any other Suraksha Setu nodes
     in radio range, and relays what it hears from them — so a chain of
     nodes with no internet at all can still pass a warning along, as long
     as ONE node in the chain has internet at some point.
   - It runs its own WiFi access point + a tiny web server, so a phone with
     no internet can join its WiFi and open 192.168.4.1 to read the last
     known alert directly, offline.

  Hardware: any ESP32 board (developed against a standard ESP32 DevKit).
  Arduino Library Manager dependency: ArduinoJson (by Benoit Blanchon, v6.x).
  Everything else (WiFi, WebServer, LittleFS, esp_now) ships with the
  ESP32 Arduino core.

  Flashing:
   1. Arduino IDE → Tools → Board → your ESP32 board.
   2. Tools → Partition Scheme → pick one with a SPIFFS/LittleFS partition
      (e.g. "Default 4MB with spiffs").
   3. Fill in the CONFIG block below for this specific node, then Upload.
   4. Open Serial Monitor at 115200 baud to watch it connect and sync.
*/

#include <WiFi.h>
#include <WebServer.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <esp_now.h>
#include <ArduinoJson.h>

// ============================== CONFIG ==============================
// Edit these for each physical node before flashing.
const char* NODE_ID        = "node-01";              // unique per board
const double NODE_LAT      = 25.5941;                 // this board's fixed install location
const double NODE_LNG      = 85.1580;                 // (e.g. from Google Maps, right-click -> coordinates)

const char* HOME_WIFI_SSID = "YOUR_WIFI_SSID";
const char* HOME_WIFI_PASS = "YOUR_WIFI_PASSWORD";

const char* LOCAL_AP_SSID  = "SurakshaSetu-Node01";   // phones join this to read the node offline
const char* LOCAL_AP_PASS  = "suraksha123";           // WPA2 needs at least 8 characters

const char* SYNC_URL       = "https://YOUR-GUJARAT-APP.vercel.app/api/esp32-sync"; // fill in once this repo is deployed to Vercel

const unsigned long FETCH_INTERVAL_MS = 10UL * 60UL * 1000UL;      // how often to check the internet, if present
const unsigned long RETAIN_SECONDS    = 5UL * 24UL * 60UL * 60UL;  // 5-day on-device history retention
// ======================================================================

#define PAYLOAD_LEN 128
#define SEEN_IDS_MAX 20
#define HISTORY_MAX 40
// Sized for a full HISTORY_MAX-entry log: each entry is at most PAYLOAD_LEN
// bytes of payload plus ~80 bytes of JSON/ArduinoJson overhead (keys,
// quoting, per-object bookkeeping).
#define HISTORY_DOC_SIZE (HISTORY_MAX * (PAYLOAD_LEN + 80))

struct AlertPacket {
  char payload[PAYLOAD_LEN];
  unsigned long timestamp;  // real unix seconds, from the server. 0 = never synced.
  uint8_t hop_count;
  uint32_t packet_id;
};

AlertPacket currentAlert = { "No alert yet", 0, 0, 0 };
uint32_t seenIds[SEEN_IDS_MAX] = {0};
int seenIdsHead = 0;

WebServer server(80);
unsigned long lastFetch = 0;

// ---------------------------------------------------------------------
// FLASH PERSISTENCE (LittleFS)
// ---------------------------------------------------------------------
const char* ALERT_FILE   = "/alert.json";
const char* HISTORY_FILE = "/history.json";

void saveAlertToFlash(const AlertPacket& a) {
  StaticJsonDocument<256> doc;
  doc["payload"] = a.payload;
  doc["timestamp"] = a.timestamp;
  doc["hop_count"] = a.hop_count;
  doc["packet_id"] = a.packet_id;
  File f = LittleFS.open(ALERT_FILE, "w");
  if (!f) { Serial.println("[FLASH] failed to open alert.json for write"); return; }
  serializeJson(doc, f);
  f.close();
}

void loadAlertFromFlash(AlertPacket& a) {
  File f = LittleFS.open(ALERT_FILE, "r");
  if (!f) { Serial.println("[FLASH] no saved alert yet"); return; }
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, f) == DeserializationError::Ok) {
    strlcpy(a.payload, doc["payload"] | "No alert yet", sizeof(a.payload));
    a.timestamp = doc["timestamp"] | 0UL;
    a.hop_count = doc["hop_count"] | 0;
    a.packet_id = doc["packet_id"] | 0;
    Serial.println("[FLASH] restored cached alert from before reboot");
  }
  f.close();
}

// Copies entries from `src` into `dst`, dropping anything older than
// RETAIN_SECONDS relative to `nowTs` — shared by the write path
// (appendHistory) and the read path (handleApiHistory), mirroring how the
// phone app's readHistory() in lib/history.ts re-prunes on every read.
void copyUnexpired(JsonArray src, JsonArray dst, unsigned long nowTs) {
  unsigned long cutoff = (nowTs > RETAIN_SECONDS) ? (nowTs - RETAIN_SECONDS) : 0;
  for (JsonObject e : src) {
    unsigned long ts = e["timestamp"] | 0UL;
    if (ts == 0 || ts >= cutoff) dst.add(e);
  }
}

// Appends to the 5-day on-device history, same policy as the phone app:
// only record an actual change, prune anything older than RETAIN_SECONDS,
// and hard-cap the entry count so flash usage stays small. The prune step
// always runs (even on a duplicate-payload no-op write), otherwise stale
// entries never age out while the alert stays unchanged.
void appendHistory(const AlertPacket& a) {
  DynamicJsonDocument loaded(HISTORY_DOC_SIZE);
  File rf = LittleFS.open(HISTORY_FILE, "r");
  if (rf) { deserializeJson(loaded, rf); rf.close(); }
  JsonArray oldArr = loaded.as<JsonArray>();

  bool isDuplicate = false;
  if (!oldArr.isNull() && oldArr.size() > 0) {
    JsonObject last = oldArr[oldArr.size() - 1];
    const char* lastPayload = last["payload"] | "";
    isDuplicate = (strcmp(lastPayload, a.payload) == 0);
  }

  DynamicJsonDocument out(HISTORY_DOC_SIZE);
  JsonArray outArr = out.to<JsonArray>();
  if (!oldArr.isNull()) copyUnexpired(oldArr, outArr, a.timestamp);

  if (!isDuplicate) {
    JsonObject entry = outArr.createNestedObject();
    entry["payload"] = a.payload;
    entry["timestamp"] = a.timestamp;
    while (outArr.size() > HISTORY_MAX) outArr.remove(0); // hard cap regardless of age
  }

  File wf = LittleFS.open(HISTORY_FILE, "w");
  if (wf) { serializeJson(outArr, wf); wf.close(); }
}

// ---------------------------------------------------------------------
// ESP-NOW MESH — lets a chain of nodes pass an alert along even with no
// internet at all, as long as one node in range has had internet recently.
// ---------------------------------------------------------------------
bool alreadySeen(uint32_t id) {
  for (int i = 0; i < SEEN_IDS_MAX; i++) if (seenIds[i] == id) return true;
  return false;
}
void rememberId(uint32_t id) {
  seenIds[seenIdsHead] = id;
  seenIdsHead = (seenIdsHead + 1) % SEEN_IDS_MAX;
}

void broadcastAlert(const AlertPacket& a, uint8_t hop) {
  AlertPacket out = a;
  out.hop_count = hop;
  uint8_t broadcastAddr[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
  esp_now_send(broadcastAddr, (uint8_t*)&out, sizeof(out));
}

// arduino-esp32 core (ESP-IDF >=5.x, what a fresh board-manager install gets
// today) requires this signature; the old (const uint8_t* mac, ...) form
// fails to compile against esp_now_register_recv_cb's expected type.
void onDataRecv(const esp_now_recv_info_t* info, const uint8_t* incomingData, int len) {
  if (len != sizeof(AlertPacket)) return;
  AlertPacket incoming;
  memcpy(&incoming, incomingData, sizeof(incoming));

  if (alreadySeen(incoming.packet_id)) return; // already relayed this one, stop the loop here
  rememberId(incoming.packet_id);

  if (incoming.timestamp > currentAlert.timestamp) {
    currentAlert = incoming;
    saveAlertToFlash(currentAlert);
    appendHistory(currentAlert);
    Serial.println("[MESH] adopted a newer alert from a neighbour node");
  }
  if (incoming.hop_count < 5) broadcastAlert(incoming, incoming.hop_count + 1); // relay onward, capped at 5 hops
}

// ---------------------------------------------------------------------
// CLOUD SYNC — talks to the website's /api/esp32-sync when this node has internet.
// ---------------------------------------------------------------------
void fetchFromCloudAndBroadcast() {
  WiFiClientSecure client;
  client.setInsecure(); // demo only: skips certificate validation. For production use client.setCACert(rootCA).

  HTTPClient http;
  http.begin(client, SYNC_URL);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<192> req;
  req["node_id"] = NODE_ID;
  req["lat"] = NODE_LAT;
  req["lng"] = NODE_LNG;
  req["last_cached_timestamp"] = currentAlert.timestamp;
  String body;
  serializeJson(req, body);

  int code = http.POST(body);
  if (code == 200) {
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
      AlertPacket fresh = {};
      strlcpy(fresh.payload, doc["payload"] | "", sizeof(fresh.payload));
      fresh.timestamp = doc["timestamp"] | 0UL; // real unix time from the server
      fresh.hop_count = 0;
      fresh.packet_id = (uint32_t)random(1, 2147483647);

      if (fresh.timestamp > currentAlert.timestamp) {
        currentAlert = fresh;
        saveAlertToFlash(currentAlert);
        appendHistory(currentAlert);
        Serial.println("[CLOUD] fetched a fresh alert, saved + broadcasting to mesh");
      }
      broadcastAlert(fresh, 0); // tell neighbours regardless, they'll dedup/compare timestamps themselves
    }
  } else {
    Serial.printf("[CLOUD] sync failed, HTTP code=%d\n", code);
  }
  http.end();
}

// ---------------------------------------------------------------------
// LOCAL WEB SERVER — a phone with no internet joins LOCAL_AP_SSID and
// opens 192.168.4.1 to read the last known alert straight from this board.
// ---------------------------------------------------------------------
void handleRoot() {
  String html = "<html><body style='font-family:sans-serif;max-width:480px;margin:24px auto;padding:0 16px'>";
  html += "<h2>Suraksha Setu — Local Node</h2>";
  html += "<p><b>Node:</b> " + String(NODE_ID) + "</p>";
  html += "<p><b>Current alert:</b> " + String(currentAlert.payload) + "</p>";
  html += "<p><b>Last updated (unix):</b> " + String(currentAlert.timestamp) + "</p>";
  html += "<p><b>WiFi status:</b> " + String(WiFi.status() == WL_CONNECTED ? "ONLINE" : "OFFLINE — showing cached/mesh data") + "</p>";
  html += "<p><a href='/api/alert'>/api/alert</a> (JSON) &middot; <a href='/api/history'>/api/history</a> (last 5 days, JSON)</p>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

void handleApiAlert() {
  StaticJsonDocument<256> doc;
  doc["node_id"] = NODE_ID;
  doc["payload"] = currentAlert.payload;
  doc["timestamp"] = currentAlert.timestamp;
  doc["online"] = (WiFi.status() == WL_CONNECTED);
  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handleApiHistory() {
  DynamicJsonDocument loaded(HISTORY_DOC_SIZE);
  File rf = LittleFS.open(HISTORY_FILE, "r");
  if (rf) { deserializeJson(loaded, rf); rf.close(); }
  JsonArray oldArr = loaded.as<JsonArray>();
  if (oldArr.isNull()) { server.send(200, "application/json", "[]"); return; }

  // Prune on read too — if the alert hasn't changed in 5+ days, appendHistory
  // hasn't run to age old entries out, so this is the only place that happens.
  DynamicJsonDocument out(HISTORY_DOC_SIZE);
  JsonArray outArr = out.to<JsonArray>();
  copyUnexpired(oldArr, outArr, currentAlert.timestamp);

  if (outArr.size() != oldArr.size()) {
    File wf = LittleFS.open(HISTORY_FILE, "w");
    if (wf) { serializeJson(outArr, wf); wf.close(); }
  }

  String body;
  serializeJson(outArr, body);
  server.send(200, "application/json", body);
}

// ---------------------------------------------------------------------
// SETUP / LOOP
// ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));

  if (!LittleFS.begin(true)) {
    Serial.println("[FLASH] LittleFS mount failed");
  }
  loadAlertFromFlash(currentAlert); // restore whatever we had before reboot

  // Run the local AP and try to join home WiFi at the same time.
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(LOCAL_AP_SSID, LOCAL_AP_PASS);
  WiFi.begin(HOME_WIFI_SSID, HOME_WIFI_PASS);
  Serial.println("Local AP started: " + String(LOCAL_AP_SSID));

  // ESP-NOW works even with no internet, needs only the WiFi radio.
  if (esp_now_init() != ESP_OK) {
    Serial.println("[MESH] ESP-NOW init failed");
  } else {
    esp_now_register_recv_cb(onDataRecv);
    esp_now_peer_info_t peerInfo = {};
    uint8_t broadcastAddr[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
    memcpy(peerInfo.peer_addr, broadcastAddr, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = false;
    esp_now_add_peer(&peerInfo);
  }

  server.on("/", handleRoot);
  server.on("/api/alert", handleApiAlert);
  server.on("/api/history", handleApiHistory);
  server.begin();
  Serial.println("Local web server started on port 80");
}

void loop() {
  server.handleClient();

  if (millis() - lastFetch > FETCH_INTERVAL_MS) {
    lastFetch = millis();
    if (WiFi.status() == WL_CONNECTED) {
      fetchFromCloudAndBroadcast();
    } else {
      Serial.println("[LOOP] No internet this cycle — relying on cached/mesh data only");
    }
  }
}
