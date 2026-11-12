// Офлайн-кэш: после первого открытия приложение работает без интернета.
// Сначала пробуем сеть (чтобы приходили обновления), без сети отдаём из кэша.
const CACHE = 'powerlift-v10';
const FILES = ['./', 'index.html', 'video.js', 'table.js', 'vendor/mp4-muxer.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, {ignoreSearch: true})
        .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
