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