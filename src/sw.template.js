/*
 * Service worker: a small script the browser keeps running in the background
 * for this site. On install it downloads every file of the app into a cache;
 * afterwards every request is answered from that cache, so the app works with
 * no network at all. VERSION is a hash of all the files, so any change
 * produces a new cache and the old one is deleted.
 */
// Both values are filled in by the build (see vite.config.ts).
const VERSION = '__VERSION__';
const CACHE = 'localcalc-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('localcalc-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // ignoreVary: script/style tags are requested with an Origin header ("crossorigin"),
  // and servers often answer "Vary: Origin" — which would make the stored copy
  // look like a non-match. Every built file has a single version, so it's safe.
  e.respondWith(caches.match(e.request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(e.request)));
});
