const CACHE_NAME = "verbrauch-app-v37";

const urlsToCache = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

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

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Verbrauch Zuhause";
  const body = payload?.notification?.body || "Neue Daten eingetragen.";

  self.registration.showNotification(title, {
    body,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: payload?.data || {}
  });
});

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
