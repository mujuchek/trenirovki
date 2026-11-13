// Офлайн-кэш: после первого открытия приложение работает без интернета.
// Сначала пробуем сеть (чтобы приходили обновления), без сети отдаём из кэша.
const CACHE = 'powerlift-v16';
const DL = 'powerlift-dl';   // последний сохранённый файл (видео или копия) — для скачивания по обычной ссылке
const FILES = ['./', 'index.html', 'video.js', 'table.js', 'vendor/mp4-muxer.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== DL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const url = new URL(req.url);
  if (url.pathname.includes('/download/')) { e.respondWith(serveDownload(req, url)); return; }
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

// Скачивание: многие браузеры (встроенные в мессенджеры, приложение с экрана «Домой» на iPhone)
// не скачивают временные ссылки blob:, а обычную ссылку сайта — скачивают. Поддерживаем перемотку
// (запросы Range), без неё iPhone такое видео не проигрывает.
async function serveDownload(req, url){
  const c = await caches.open(DL);
  const r = await c.match(url.origin + url.pathname);
  if (!r) return new Response('Файл не найден — сохраните его в приложении ещё раз', {status:404, headers:{'Content-Type':'text/plain; charset=utf-8'}});
  const blob = await r.blob();
  const type = r.headers.get('Content-Type') || 'application/octet-stream';
  const name = decodeURIComponent(url.pathname.split('/').pop());
  const disp = url.searchParams.has('view') ? 'inline' : `attachment; filename="${name}"`;
  const head = {'Content-Type':type, 'Accept-Ranges':'bytes', 'Content-Disposition':disp};
  const range = req.headers.get('Range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    let s = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : blob.size - 1;
    if (!m[1] && m[2]) { s = Math.max(0, blob.size - +m[2]); end = blob.size - 1; }
    end = Math.min(end, blob.size - 1);
    return new Response(blob.slice(s, end + 1), {status:206, headers:{...head, 'Content-Range':`bytes ${s}-${end}/${blob.size}`, 'Content-Length':String(end - s + 1)}});
  }
  return new Response(blob, {headers:{...head, 'Content-Length':String(blob.size)}});
}
