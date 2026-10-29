import { building } from '$app/environment';
import { redirect, type Handle } from '@sveltejs/kit';

/**
 * Guard de sesión en el `Handle` de SvelteKit: cualquier petición sin sesión se
 * redirige a `/login` (conservando la URL en `redirectTo` para volver tras el
 * login). Vive aquí y no en `+layout.server.ts` porque un `load` de layout no
 * cubre `+server.ts` ni form actions.
 *
 * Va DESPUÉS de `betterAuthHandle` en la secuencia: es quien deja
 * `event.locals.user` relleno.
 */

/** Rutas que no exigen sesión: la portada (la landing pública), la página de login, la API de better-auth (el propio flujo de login va sin sesión), las probes del clúster y lo demás que va sin sesión. */
export function isPublicPathname(pathname: string): boolean {
	return (
		// La portada es la landing pública (issue #133): quien llega por primera
		// vez (p. ej. desde una invitación) debe poder ver qué es la app sin
		// sesión. Con sesión se muestra la misma landing (sólo cambia el CTA).
		pathname === '/' ||
		// Su `__data.json`, que pide el router en cliente al navegar a `/`.
		pathname === '/__data.json' ||
		// `/login` exacta y su `__data.json` (`/login/...`), que pide el router en cliente.
		pathname === '/login' ||
		pathname.startsWith('/login/') ||
		pathname.startsWith('/api/auth/') ||
		// Probes de Kubernetes (issue #124): el kubelet va sin sesión.
		// `/healthz` es liveness (sin BD); `/readyz`, readiness (`SELECT 1`).
		pathname === '/healthz' ||
		pathname === '/readyz' ||
		// Vista de una invitación por token (issue #61): el token del enlace es
		// la credencial, y quien llega sin sesión debe poder VER que la
		// invitación existe (o que ya caducó) antes de crear cuenta. Responderla
		// sí exige sesión: lo aplica la propia página, que manda a
		// `/login?…&email=` a quien quiera aceptar o rechazar sin ella.
		pathname.startsWith('/invitations/') ||
		pathname === '/robots.txt'
	);
}

/**
 * Assets que NO exigen sesión. Es el mismo patrón que `betterAuthHandle` se
 * salta con `skipAssets`: esas peticiones nunca resuelven sesión, así que si el
 * guard se las exigiera, ni el propio `/login` cargaría su JS.
 */
const ASSET_PATHNAME_PATTERN = /\.(?:ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf)$/;

function isAssetPathname(pathname: string): boolean {
	return (
		pathname.startsWith('/_app/') ||
		pathname === '/service-worker.js' ||
		// PWA (issue #135): el manifest y la página offline son ficheros estáticos
		// que el service worker precachea en `install` (y Chrome pide el manifest
		// al instalar), sin sesión. VAN AQUÍ y no como extensiones en el patrón:
		// añadir `.json` expondría los `__data.json` sin sesión, y `.html` de
		// paso haría pública cualquier ruta futura que acabe en .html.
		pathname === '/manifest.webmanifest' ||
		pathname === '/offline.html' ||
		ASSET_PATHNAME_PATTERN.test(pathname)
	);
}

export const handleAuthGuard: Handle = ({ event, resolve }) => {
	// Durante el prerender no hay request real ni cookie: exigir sesión rompería el build.
	if (building) {
		return resolve(event);
	}

	const { pathname, search } = event.url;
	if (event.locals.user || isPublicPathname(pathname) || isAssetPathname(pathname)) {
		return resolve(event);
	}

	// Se conserva path + query para que el login devuelva al usuario donde estaba.
	// El 302 vale también para POST (endpoints y form actions): lo sigue tanto el
	// navegador como el router de SvelteKit.
	const redirectTo = encodeURIComponent(`${pathname}${search}`);
	redirect(302, `/login?redirectTo=${redirectTo}`);
};
