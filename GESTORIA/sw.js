/* eslint-disable no-restricted-globals */
/**
 * Service Worker – Gestoría PWA
 * Estrategia: Stale-While-Revalidate para recursos estáticos.
 * Las peticiones a Supabase pasan directo (la app gestiona la cola offline).
 */

const CACHE_VERSION = 'gestoria-pwa-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.29/jspdf.plugin.autotable.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

function isSupabaseRequest(url) {
    return url.hostname.includes('supabase.co');
}

async function cacheStaticAssets() {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.allSettled(
        STATIC_ASSETS.map(async (asset) => {
            try {
                const url = new URL(asset, self.location.href).href;
                const response = await fetch(url, { mode: asset.startsWith('http') ? 'cors' : 'same-origin' });
                if (response.ok) {
                    await cache.put(url, response);
                }
            } catch (err) {
                console.warn('[SW] No se pudo precachear:', asset, err);
            }
        })
    );
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        cacheStaticAssets().then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key.startsWith('gestoria-pwa-') && key !== STATIC_CACHE)
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

/**
 * Stale-While-Revalidate: responde desde caché al instante y actualiza en segundo plano.
 */
async function staleWhileRevalidate(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);

    const networkFetch = fetch(request)
        .then((response) => {
            if (response && response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    if (cached) {
        networkFetch.catch(() => {});
        return cached;
    }

    const networkResponse = await networkFetch;
    if (networkResponse) return networkResponse;

    if (request.mode === 'navigate') {
        const fallback = await cache.match(new URL('./index.html', self.location.href).href);
        if (fallback) return fallback;
    }

    return new Response('Sin conexión y recurso no disponible en caché.', {
        status: 503,
        statusText: 'Offline'
    });
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (isSupabaseRequest(url)) {
        return;
    }

    if (request.method === 'GET') {
        event.respondWith(staleWhileRevalidate(request));
    }
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
