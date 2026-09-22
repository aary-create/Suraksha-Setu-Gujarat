// Network first for pages; if the network is down, serve the cached page,
// falling back to the saved history view which works entirely offline.
const CACHE = "suraksha-v5";
const SHELL = ["/", "/history", "/help"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.startsWith("/api/")) return; // the alert screen handles API failures itself
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match("/history") : Response.error()))
  );
});

// Server-initiated alerts, so a phone that isn't showing the app still gets
// warned. `requireInteraction` keeps an Extreme warning on screen until it's
// acknowledged instead of auto-dismissing after a few seconds.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const severe = d.severity === "Extreme" || d.severity === "Severe";
  e.waitUntil(
    self.registration.showNotification(d.title || "Weather alert", {
      body: d.body || "",
      tag: d.alertId || "suraksha-alert",
      renotify: true,
      requireInteraction: severe,
      vibrate: severe ? [300, 120, 300, 120, 300] : [200],
      data: { url: d.url || "/" },
    })
  );
});

// Tapping an alert notification opens the alert screen.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((wins) => {
      const url = (e.notification.data && e.notification.data.url) || "/";
      const open = wins.find((w) => new URL(w.url).pathname === url);
      return open ? open.focus() : self.clients.openWindow(url);
    })
  );
});
