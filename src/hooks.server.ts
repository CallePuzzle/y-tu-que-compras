import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { betterAuthHandle } from '@callepuzzle/auth/hooks';
import { auth } from '#lib/server/auth.js';
import { getTextDirection } from '#lib/paraglide/runtime.js';
import { paraglideMiddleware } from '#lib/paraglide/server.js';

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

// betterAuthHandle resuelve la sesion una vez por request (event.locals) y
// atiende /api/auth/*; `building` evita resolver sesion durante el prerender.
export const handle: Handle = sequence(betterAuthHandle(auth, building), handleParaglide);
