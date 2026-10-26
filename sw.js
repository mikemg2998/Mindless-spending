/* Mindless Spending — offline support.
   Network first (so changes pushed to the site arrive as soon as there is a connection), cache as fallback (so it works offline). */
const CACHE = 'mindless-v3';
const CORE = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function withTimeout(promise, ms){
  return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); promise.then(v => { clearTimeout(t); resolve(v); }, err => { clearTimeout(t); reject(err); }); });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const res = await withTimeout(fetch(req, {cache: 'no-cache'}), 5000);
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      } catch (err) {
        const hit = await caches.match(req, {ignoreSearch: true});
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw err;
      }
    })());
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
