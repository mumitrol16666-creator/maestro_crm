// Service Worker для кэширования статических ресурсов
const STATIC_VERSION = 'v20240220';
const STATIC_CACHE = `static-${STATIC_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${STATIC_VERSION}`;

const STATIC_FILES = [
    '/',
    '/index.html',
    '/css/styles.css?v=2',
    '/css/admin-styles.css?v=66',
    '/js/admin.js?v=321',
    '/js/script.js',
    '/js/config.js',
    '/assets/images/logo-splash.PNG',
    '/assets/images/favicon.PNG'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(STATIC_FILES))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (![STATIC_CACHE, DYNAMIC_CACHE].includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') {
        return;
    }

    if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|ico)$/)) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) {
                    return cached;
                }

                return fetch(request).then(response => {
                    if (response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(STATIC_CACHE).then(cache => cache.put(request, responseClone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    if (url.pathname.endsWith('.html') || url.pathname === '/') {
        event.respondWith(
            fetch(request).then(networkResponse => {
                if (networkResponse.status === 200) {
                    const clone = networkResponse.clone();
                    caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, clone));
                }
                return networkResponse;
            }).catch(() => caches.match(request).then(match => match || caches.match('/index.html')))
        );
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(request));
    }
});

self.addEventListener('message', event => {
    if (event.data?.type === 'CLEAR_CACHE') {
        caches.keys().then(cacheNames => {
            cacheNames.forEach(cacheName => caches.delete(cacheName));
        });
    }
});
