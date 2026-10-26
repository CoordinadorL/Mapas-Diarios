// ═══════════════════════════════════════════════════════════
// Service Worker — OPAUSTRO (login, menú de Inicio y Cargues)
// Permite instalación en pantalla de inicio y caché básico
// ═══════════════════════════════════════════════════════════
const CACHE_NAME = 'mapas-diarios-v57';
// Caché separada para las imágenes del mapa (calles) que usan los mapas de
// Cargue. Aparte de CACHE_NAME para que actualizar la app no la borre.
const TILES_CACHE_NAME = 'mapas-diarios-tiles-v1';

// Recursos a cachear para uso offline básico
const CACHE_ASSETS = [
  './login.html',
  './inicio.html',
  './menu-config.js',
  './mapas.html',
  './mymaps.html',
  './servicio-local.js',
  './pago-transportes.html',
  './pago-transportes.js',
  './herramientas.css',
  './manifest.json',
  './logo-wordmark.png',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

// Instalar: cachear recursos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Cacheando recursos...');
      // cache:'reload': bajar SIEMPRE de la red. Sin esto, si la version nueva
      // se instala a los pocos minutos de la anterior, el navegador puede dar
      // las paginas viejas de su cache HTTP (GitHub Pages: max-age=600) y la
      // app seguiria con el codigo anterior aunque CACHE_NAME sea nuevo.
      return cache.addAll(CACHE_ASSETS.map(u => new Request(u, { cache: 'reload' }))).catch(err => {
        console.warn('[SW] Algunos recursos no se pudieron cachear:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activar: limpiar cachés viejos (conserva la de tiles -- no es "de la app",
// son las imágenes de calles ya vistas en los mapas de Cargue)
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

  // Servicios de la PC (Generar mapas / My Maps en el 5178, backends de
  // prueba...): nunca pasan por la caché, siempre directo (es el estado en
  // vivo del programa). Solo la propia app en localhost usa la caché.
  if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.host !== self.location.host) return;
  if (event.request.method !== 'GET') return;

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
  // pero si no hay señal se sirve lo que ya se había visto antes -- así el
  // mapa no se queda en blanco.
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
