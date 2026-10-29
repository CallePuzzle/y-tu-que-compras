/// <reference types="@sveltejs/kit" />

import { build, files, version } from '$service-worker';

const worker = self;
const CACHE_NAME = `static-cache-${version}`;

// El build inmutable de cliente más todos los ficheros estáticos (iconos,
// manifest, offline.html…). `offline.html` en caché es lo que sirve el
// fallback de `fetch` cuando una navegación se queda sin red.
const to_cache = build.concat(files);

worker.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.addAll(to_cache).then(() => {
				worker.skipWaiting();
			});
		})
	);
});

worker.addEventListener('activate', (event) => {
	// Remove previous cached data from disk
	event.waitUntil(
		caches.keys().then(async (keys) =>
			Promise.all(
				keys.map((key) => {
					if (key !== CACHE_NAME) {
						return caches.delete(key);
					}
				})
			)
		)
	);
	worker.clients.claim();
});

// Solo navegaciones: los assets inmutables van con su propia caché HTTP y el
// resto de peticiones (API, form actions…) no debe servirse obsoleta. Sin red,
// el fallback es la página estática offline.
worker.addEventListener('fetch', (event) => {
	if (event.request.mode !== 'navigate') {
		return;
	}
	event.respondWith(
		fetch(event.request).catch(() => {
			return caches.open(CACHE_NAME).then((cache) => {
				return cache.match('offline.html');
			});
		})
	);
});
