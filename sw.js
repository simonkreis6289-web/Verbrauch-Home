const CACHE_NAME = "verbrauch-app-v130";

const urlsToCache = [
  "./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./push-badge-72.png"
];

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { data: { body: event.data ? event.data.text() : "" } }; }
  const title = String(payload?.data?.title || payload?.notification?.title || "Verbrauch Zuhause");
  const body = String(payload?.data?.body || payload?.notification?.body || "Neue Benachrichtigung");
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: "./icon-192.png", badge: "./push-badge-72.png",
    vibrate: [180, 100, 180], silent: false, renotify: false,
    tag: "verbrauch-push-" + Date.now(), timestamp: Date.now(), data: payload?.data || {}
  }));
});

importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyBrKjajSNPgmFUwjMghkox1kM8NjbCWZ_Y",
  authDomain: "verbrauch-zuhause.firebaseapp.com",
  projectId: "verbrauch-zuhause",
  storageBucket: "verbrauch-zuhause.firebasestorage.app",
  messagingSenderId: "546121139332",
  appId: "1:546121139332:web:b07b58184fb0388565aed1",
  measurementId: "G-L0GQQ8V785"
});
const messaging = firebase.messaging();
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => {
    if (key !== CACHE_NAME) return caches.delete(key);
  }))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  // API calls (especially authenticated POST /weather/list) must never be intercepted.
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(event.request);
    return cached || Response.error();
  }));
});
