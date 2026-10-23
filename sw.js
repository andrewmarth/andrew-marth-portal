// Service worker so the portal can be installed as an app on a phone.
// Nothing is cached: every page and sheet request goes straight to the network, so data is always current.
self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Only the portal's own pages pass through here; sign-in and the sheet API (other sites) are left alone
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    event.respondWith(fetch(event.request));
});
