// A minimal Service Worker to satisfy PWA installation requirements
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Pass through all requests normally
    event.respondWith(fetch(event.request));
});
