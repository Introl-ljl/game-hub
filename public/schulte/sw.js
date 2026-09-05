const CACHE_NAME = 'schulte-daily-v29';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=29',
  './app.js?v=29',
  './api.js?v=29',
  './theme.js?v=29',
  './data/daily-levels.json',
  '/fonts/fonts.css',
  '/fonts/rajdhani-latin-500-normal.woff2',
  '/fonts/rajdhani-latin-600-normal.woff2',
  '/fonts/rajdhani-latin-700-normal.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const mustRevalidate = event.request.mode === 'navigate'
    || url.pathname.startsWith('/api/')
    || url.pathname.endsWith('/daily-levels.json')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css');

  if (mustRevalidate) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (url.pathname.startsWith('/api/')) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => {
          if (url.pathname.startsWith('/api/')) {
            return Response.json({ error: '排行榜服务当前离线', code: 'API_OFFLINE' }, { status: 503 });
          }
          return caches.match(event.request).then((cached) => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }))
  );
});
