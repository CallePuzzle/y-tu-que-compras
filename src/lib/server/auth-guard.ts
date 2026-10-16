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

/** Rutas que no exigen sesión: la página de login y la API de better-auth (el propio flujo de login va sin sesión). */
export function isPublicPathname(pathname: string): boolean {
	return (
		// `/login` exacta y su `__data.json` (`/login/...`), que pide el router en cliente.
		pathname === '/login' ||
		pathname.startsWith('/login/') ||
		pathname.startsWith('/api/auth/') ||
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
