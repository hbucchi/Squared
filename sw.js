/*
 * Service worker: a small script the browser keeps running in the background
 * for this site. On install it downloads every file of the app into a cache;
 * afterwards every request is answered from that cache, so the app works with
 * no network at all. The build script stamps VERSION so an update replaces
 * the old cache.
 */
const VERSION = 'dev';
const CACHE = 'localcalc-' + VERSION;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/formula.js', 'js/format.js', 'js/functions.js', 'js/engine.js', 'js/io.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

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
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
