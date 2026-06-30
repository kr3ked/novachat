self.addEventListener('install', e => {
    e.waitUntil(
        caches.open('novachat-v1').then(cache =>
            cache.addAll(['/', '/index.html', '/css/style.css',
                          '/js/api.js', '/js/auth.js', '/js/chat.js',
                          '/js/channel.js', '/js/app.js'])
        )
    );
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request))
    );
});
/**
 * Service Worker для PWA
 * Обеспечивает офлайн-работу и кеширование
 */

const CACHE_NAME = 'novachat-v1';
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
    '/manifest.json',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    'https://cdn.socket.io/4.7.4/socket.io.min.js'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker устанавливается...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Кеш создан');
                // Кешируем по одному, чтобы не упасть если один файл недоступен
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
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Не кешируем API запросы и WebSocket
    if (url.pathname.startsWith('/api/') || 
        url.pathname.startsWith('/socket.io/') ||
        url.hostname.includes('onrender.com') ||
        url.hostname.includes('telegram.org')) {
        return;
    }
    
    // Стратегия "Cache First" для статики
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Если есть в кеше — отдаём
                if (response) {
                    return response;
                }
                
                // Иначе — загружаем и кешируем
                return fetch(event.request)
                    .then((response) => {
                        // Кешируем только успешные ответы
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });
                        
                        return response;
                    })
                    .catch(() => {
                        // Если офлайн и нет в кеше — показываем главную
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});

// Push-уведомления (для будущего)
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

// Клик по уведомлению
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/')
    );
});

console.log('🚀 NovaChat Service Worker загружен!');