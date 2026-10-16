import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/environment';
import { betterAuthHandle } from '@callepuzzle/auth/hooks';
import { auth } from '$lib/server/auth';
import { getTextDirection } from '$lib/paraglide/runtime.js';
import { paraglideMiddleware } from '$lib/paraglide/server.js';

// La CSP la genera SvelteKit (`kit.csp` en svelte.config.js); aquí va el resto.
// `X-Frame-Options` duplica `frame-ancestors 'none'` para navegadores antiguos.
const securityHeaders: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	...(dev ? {} : { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' })
};

const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(securityHeaders)) {
		response.headers.set(name, value);
	}
	return response;
};

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		return resolve(
			{ ...event, request },
			{
				transformPageChunk: ({ html }) =>
					html
						.replace('%paraglide.lang%', locale)
						.replace('%paraglide.dir%', getTextDirection(locale))
			}
		);
	});

// betterAuthHandle resuelve la sesión una vez por request (event.locals) y
// atiende /api/auth/*; `building` evita resolver sesión durante el prerender y
// `skipAssets` se la ahorra en `/_app/*`, imágenes y fuentes.
export const handle: Handle = sequence(
	handleSecurityHeaders,
	betterAuthHandle(auth, building, { skipAssets: true }),
	handleParaglide
);
