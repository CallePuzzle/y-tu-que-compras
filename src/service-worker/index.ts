// Service worker de la PWA (issue #135). Kit 3: `version` vive en `$app/env`,
// los listados del build en `$app/manifest` (ya no existe `$service-worker`) y
// el contexto tipado del worker, en `$app/service-worker` — junto a un
// tsconfig propio (`tsconfig.json` aquí, lib WebWorker) porque los tipos de
// `fetch`/`ExtendableEvent` difieren de los del proyecto raíz.
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self as worker } from '$app/service-worker';

const CACHE_NAME = `static-cache-${version}`;

// El build inmutable de cliente más todos los ficheros estáticos (iconos,
// manifest, offline.html…). `offline.html` en caché es lo que sirve el
// fallback de `fetch` cuando una navegación se queda sin red. Ojo a las
// formas de kit 3: cada entrada es `{ path }`, no un string plano.
const to_cache = [...immutable, ...assets].map((entry) => entry.path);

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
		fetch(event.request).catch(() =>
			caches
				.open(CACHE_NAME)
				.then((cache) => cache.match('offline.html'))
				// `offline.html` se precachea en `install` (addAll lo garantiza), pero
				// `cache.match` puede no encontrarla y `respondWith` exige Response.
				.then((offline) => offline ?? new Response(null, { status: 503 }))
		)
	);
});
