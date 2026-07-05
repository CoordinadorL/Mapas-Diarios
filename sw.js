// ═══════════════════════════════════════════════════════════
// Service Worker — Mapas Diarios PWA
// Permite instalación en pantalla de inicio y caché básico
// ═══════════════════════════════════════════════════════════
const CACHE_NAME = 'mapas-diarios-v21';

// Recursos a cachear para uso offline básico
const CACHE_ASSETS = [
  './login.html',
  './resumen.html',
  './mapa_live_F150.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

// Instalar: cachear recursos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Cacheando recursos...');
      return cache.addAll(CACHE_ASSETS).catch(err => {
        console.warn('[SW] Algunos recursos no se pudieron cachear:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activar: limpiar cachés viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Eliminando caché viejo:', k);
          return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch: Network-first para datos de Google Sheets, cache-first para estáticos
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Google Sheets API y Maps → siempre network (datos en tiempo real)
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('allorigins.win') ||
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('basemaps.cartocdn.com') ||
    url.hostname.includes('maps.googleapis.com') ||
    url.hostname.includes('waze.com')
  ) {
    event.respondWith(fetch(event.request).catch(() => {
      // Si falla la red, no hacer nada (el mapa manejará el error)
      return new Response('', { status: 503 });
    }));
    return;
  }

  // Recursos estáticos (Leaflet, CSS, HTML) → cache-first con fallback a network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cachear nuevas respuestas exitosas
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return response;
      }).catch(() => {
        return new Response('<h2>Sin conexión</h2>', {
          headers: { 'Content-Type': 'text/html' }
        });
      });
    })
  );
});
