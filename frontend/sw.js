/**
 * Service Worker для PWA (v3)
 * Стратегия Network First - всегда пробуем свежее, кеш только для офлайн
 */

const CACHE_NAME = 'novachat-v3';

const CACHE_URLS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/api.js',
    '/js/auth.js',
    '/js/chat.js',
    '/js/channel.js',
    '/js/notifications.js',
    '/js/app.js',
    '/manifest.json'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker устанавливается...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Кеш создан');
                return Promise.all(
                    CACHE_URLS.map(url => 
                        cache.add(url).catch(err => 
                            console.log('⚠️ Не удалось кешировать:', url)
                        )
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// Активация - удаляем старый кеш
self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker активирован');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('🗑 Удаляем старый кеш:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// Перехват запросов - NETWORK FIRST
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Не кешируем API запросы и WebSocket
    if (url.pathname.startsWith('/api/') || 
        url.pathname.startsWith('/socket.io/') ||
        url.hostname.includes('onrender.com') ||
        url.hostname.includes('telegram.org')) {
        return;
    }
    
    // Для HTML, JS, CSS - всегда пробуем свежую версию
    if (event.request.destination === 'document' ||
        event.request.destination === 'script' ||
        event.request.destination === 'style' ||
        event.request.destination === '') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => cache.put(event.request, responseToCache));
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request);
                })
        );
        return;
    }
    
    // Для остального (картинки, шрифты) - Cache First
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) return response;
                
                return fetch(event.request)
                    .then((response) => {
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => cache.put(event.request, responseToCache));
                        
                        return response;
                    })
                    .catch(() => {
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});

// Push уведомления
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'NovaChat';
    const options = {
        body: data.body || 'Новое сообщение',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        data: data.data || {}
    };
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/')
    );
});

console.log('🚀 NovaChat Service Worker v3 загружен!');