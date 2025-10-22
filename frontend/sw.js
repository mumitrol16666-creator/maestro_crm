// Service Worker для кэширования статических ресурсов
const CACHE_NAME = 'sense-of-dance-v1';
const STATIC_CACHE = 'static-v1';
const DYNAMIC_CACHE = 'dynamic-v1';

// Файлы для кэширования при установке
const STATIC_FILES = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/css/admin-styles.css',
    '/js/script.js',
    '/js/config.js',
    '/assets/images/logo-splash.PNG',
    '/assets/images/favicon.PNG'
];

// Установка Service Worker
self.addEventListener('install', event => {
    console.log('🔧 Service Worker installing...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('📦 Caching static files');
                return cache.addAll(STATIC_FILES);
            })
            .then(() => {
                console.log('✅ Service Worker installed');
                return self.skipWaiting();
            })
    );
});

// Активация Service Worker
self.addEventListener('activate', event => {
    console.log('🚀 Service Worker activating...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
                            console.log('🗑️ Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('✅ Service Worker activated');
                return self.clients.claim();
            })
    );
});

// Перехват запросов
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Стратегия кэширования для разных типов ресурсов
    if (request.method === 'GET') {
        // Статические ресурсы (CSS, JS, изображения)
        if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|ico)$/)) {
            event.respondWith(
                caches.match(request)
                    .then(response => {
                        if (response) {
                            console.log('📦 Cache HIT:', url.pathname);
                            return response;
                        }
                        
                        console.log('🔄 Cache MISS:', url.pathname);
                        return fetch(request)
                            .then(fetchResponse => {
                                // Кэшируем успешные ответы
                                if (fetchResponse.status === 200) {
                                    const responseClone = fetchResponse.clone();
                                    caches.open(STATIC_CACHE)
                                        .then(cache => {
                                            cache.put(request, responseClone);
                                        });
                                }
                                return fetchResponse;
                            })
                            .catch(() => {
                                // Fallback для изображений
                                if (url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/)) {
                                    return new Response('', { status: 404 });
                                }
                            });
                    })
            );
        }
        // HTML страницы
        else if (url.pathname.endsWith('.html') || url.pathname === '/') {
            event.respondWith(
                fetch(request)
                    .then(response => {
                        // Кэшируем HTML страницы
                        if (response.status === 200) {
                            const responseClone = response.clone();
                            caches.open(DYNAMIC_CACHE)
                                .then(cache => {
                                    cache.put(request, responseClone);
                                });
                        }
                        return response;
                    })
                    .catch(() => {
                        // Fallback к кэшу
                        return caches.match(request)
                            .then(response => {
                                return response || caches.match('/index.html');
                            });
                    })
            );
        }
        // API запросы - не кэшируем, всегда идем в сеть
        else if (url.pathname.startsWith('/api/')) {
            event.respondWith(fetch(request));
        }
    }
});

// Очистка старых кэшей
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.keys().then(cacheNames => {
            cacheNames.forEach(cacheName => {
                caches.delete(cacheName);
            });
        });
    }
});

console.log('🎉 Service Worker loaded successfully!');
