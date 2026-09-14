/* Service worker — hace que la app abra y funcione sin conexión.

   Estrategia:
   · index.html, app.js, styles.css, manifest.json → RED PRIMERO (con 2,5 s de
     paciencia) y caché de respaldo. Así, al abrir la app con wifi siempre llega
     la última versión publicada, sin tener que tocar nada aquí.
   · vendor/ e icons/ → CACHÉ PRIMERO. Son archivos pesados que casi nunca
     cambian. Si cambias alguno, sube VERSION para forzar su renovación.
*/

const VERSION = 'buscador-v2';
const LIMITE_RED = 2500;   // ms antes de rendirse y servir desde caché

const RECURSOS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './vendor/papaparse.min.js',
  './vendor/zxing.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

const esCascaron = ruta =>
  ruta.endsWith('/') ||
  ruta.endsWith('/index.html') ||
  ruta.endsWith('/app.js') ||
  ruta.endsWith('/styles.css') ||
  ruta.endsWith('/manifest.json');

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSION).then(c => c.addAll(RECURSOS)));
});

self.addEventListener('message', ev => {
  if (ev.data === 'SALTAR') self.skipWaiting();
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function redConLimite(req) {
  return new Promise((ok, mal) => {
    const reloj = setTimeout(() => mal(new Error('lenta')), LIMITE_RED);
    fetch(req).then(res => { clearTimeout(reloj); ok(res); },
                    err => { clearTimeout(reloj); mal(err); });
  });
}

function guardar(req, res) {
  if (res && res.status === 200 && res.type === 'basic') {
    const copia = res.clone();
    caches.open(VERSION).then(c => c.put(req, copia));
  }
  return res;
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Cascarón de la app: red primero, caché si no hay señal o va muy lenta
  if (req.mode === 'navigate' || esCascaron(url.pathname)) {
    ev.respondWith(
      redConLimite(req)
        .then(res => guardar(req.mode === 'navigate' ? new Request('./index.html') : req, res))
        .catch(() => caches.match(req)
          .then(r => r || caches.match('./index.html'))
          .then(r => r || caches.match('./')))
    );
    return;
  }

  // Librerías e iconos: caché primero
  ev.respondWith(
    caches.match(req).then(cacheado => cacheado || fetch(req).then(res => guardar(req, res)))
  );
});
