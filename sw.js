/** Minimal service worker — enables PWA install; network-only (no offline cache). */
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
