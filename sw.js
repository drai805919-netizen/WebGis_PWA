/* Service Worker — نسخه‌ی محلی (MBTiles): فقط فایل‌های خود برنامه کش می‌شوند؛ هیچ درخواست شبکه‌ای به سرویس بیرونی نیست. */
const V = 'webgis-local-v1.05.32';
const CORE = ['./', './index.html', './guide.html', './manifest.json', './mbtiles.js', './icon-192.png', './icon-512.png', './icon.svg', './favicon-48.png', './apple-touch-icon.png',
];
/* کتابخانه‌ها: اول از پوشه‌ی lib میزبان؛ اگر نبود، فقط همین یک‌بار از CDN گرفته و کش می‌شوند */
const B = 'https://cdnjs.cloudflare.com/ajax/libs/', LM = B + 'leaflet/1.9.4/';
const LIBS = { './lib/leaflet.min.js': LM + 'leaflet.min.js', './lib/leaflet.min.css': LM + 'leaflet.min.css', './lib/images/layers.png': LM + 'images/layers.png', './lib/images/layers-2x.png': LM + 'images/layers-2x.png',
  './lib/images/marker-icon.png': LM + 'images/marker-icon.png', './lib/images/marker-icon-2x.png': LM + 'images/marker-icon-2x.png', './lib/images/marker-shadow.png': LM + 'images/marker-shadow.png',
  './lib/turf.min.js': B + 'Turf.js/6.5.0/turf.min.js', './lib/jszip.min.js': B + 'jszip/3.10.1/jszip.min.js', './lib/jsQR.min.js': B + 'jsQR/1.4.0/jsQR.min.js', './lib/zxing.min.js': 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js' };
const get = (u, o) => fetch(u, o).then(r => { if (!r.ok) throw new Error(u); return r; });
self.addEventListener('install', e => {
  self.skipWaiting();
  /* اگر فایلی نه از میزبان و نه از CDN گرفته شود، نصب شکست می‌خورد تا برنامه‌ی ناقص «آفلاین‌آماده» تلقی نشود */
  e.waitUntil(caches.open(V).then(async c => {
    await Promise.all(CORE.map(u => get(u, { cache: 'reload' }).then(r => c.put(u, r))));
    await Promise.all(Object.keys(LIBS).map(u => get(u, { cache: 'reload' }).catch(() => get(LIBS[u])).then(r => c.put(u, r))));
  }));
});
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(r, { ignoreSearch: true });
    if (hit) { /* به‌روزرسانی پس‌زمینه وقتی اینترنت هست */ fetch(r).then(n => { if (n && n.ok) c.put(r, n.clone()) }).catch(() => { }); return hit; }
    try { const n = await fetch(r); if (n && n.ok) c.put(r, n.clone()); return n; }
    catch (err) { if (r.mode === 'navigate') return (await c.match('./index.html')) || Response.error(); return Response.error(); }
  }));
});
