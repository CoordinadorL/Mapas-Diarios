// ═══════════════════════════════════════════════════════════
// Service Worker — Mapas Diarios PWA
// Permite instalación en pantalla de inicio y caché básico
// ═══════════════════════════════════════════════════════════
const CACHE_NAME = 'mapas-diarios-v31';
// Caché separada para las imágenes del mapa (calles) -- ruta-dinamica.js la
// llena por adelantado con la zona de la ruta del día. Aparte de CACHE_NAME
// para que actualizar la app (subir CACHE_NAME) no borre el mapa ya descargado.
const TILES_CACHE_NAME = 'mapas-diarios-tiles-v1';

// Recursos a cachear para uso offline básico
const CACHE_ASSETS = [
  './login.html',
  './resumen.html',
  './mapa_live_F150.html',
  './mapa-utils.js',
  './mapa-auth-sync.js',
  './mapa-api.js',
  './mapa-render.js',
  './mapa-panel-stats.js',
  './mapa-cuadre-fotos.js',
  './ruta-dinamica.js',
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

// Activar: limpiar cachés viejos (conserva la de tiles -- no es "de la app",
// es la descarga de mapas offline que ruta-dinamica.js va llenando)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== TILES_CACHE_NAME).map(k => {
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

  // Google Sheets API y ORS → siempre network (datos en tiempo real, nunca servir algo viejo)
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('allorigins.win') ||
    url.hostname.includes('openrouteservice.org')
  ) {
    event.respondWith(fetch(event.request).catch(() => {
      // Si falla la red, no hacer nada (el mapa manejará el error)
      return new Response('', { status: 503 });
    }));
    return;
  }

  // Imágenes del mapa (calles) → red primero (siempre lo más fresco posible),
  // pero si no hay señal se sirve lo que ruta-dinamica.js precargó para la
  // zona de la ruta del día -- así el mapa no se queda en blanco.
  if (url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('basemaps.cartocdn.com')) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(TILES_CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return response;
      }).catch(() =>
        caches.open(TILES_CACHE_NAME).then(cache => cache.match(event.request)).then(cached =>
          cached || new Response('', { status: 503 })
        )
      )
    );
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
