const CACHE_NAME = "estacao-sentinela-v2";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./manifest.json",
    "./service-worker.js",
    "./images/icon-192.png",
    "./images/icon-512.png"
];

// Instalação e armazenamento dos arquivos.
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Ativação e limpeza de caches antigos.
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Respostas usando o cache quando possível.
self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);

    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse ||
                fetch(event.request).catch(() => {
                    if (event.request.mode === "navigate") {
                        return caches.match("./index.html");
                    }
                });
        })
    );
});