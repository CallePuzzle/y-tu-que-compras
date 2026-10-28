import { createHash, randomUUID } from 'node:crypto';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { betterAuthHandle } from '@callepuzzle/auth/hooks';
import { auth } from '$lib/server/auth';
import { handleAuthGuard } from '$lib/server/auth-guard';
import { handleFamilyContext } from '$lib/server/family-context.js';
import logger from '$lib/server/logger';
import { extractLocaleFromRequest, getTextDirection, type Locale } from '$lib/paraglide/runtime.js';
import { paraglideMiddleware } from '$lib/paraglide/server.js';
import { m } from '$lib/paraglide/messages.js';

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

// Fase 2: etiqueta la traza raíz con un hash del usuario (nunca el id directo:
// SHA-256 con una salt dedicada y truncado a 16 caracteres). Sin
// `OBSERVABILITY_SALT` definida la traza no se etiqueta.
const handleUserTrace: Handle = ({ event, resolve }) => {
	const salt = env.OBSERVABILITY_SALT;
	const user = event.locals.user;
	if (salt && user) {
		const hash = createHash('sha256').update(`${user.id}${salt}`).digest('hex').slice(0, 16);
		event.tracing.root.setAttribute('user.hash', hash);
	}
	return resolve(event);
};

// Log estructurado por request (JSON en stdout; lo recogen los logs del
// contenedor en el clúster). Va
// primero en la secuencia para que `event.locals.log` esté disponible en el
// resto de handles (y en `handleError`).
const handleLogging: Handle = async ({ event, resolve }) => {
	// `x-vercel-id` es el id de correlación que inyecta Vercel (de donde viene
	// la app): solo se respeta si SOMOS Vercel quien sirve la request
	// (`env.VERCEL` lo fija la plataforma). Fuera de Vercel (clúster k0s, local)
	// cualquiera podría enviar esa cabecera y falsear o reutilizar ids en logs
	// y trazas, así que ahí cae a un uuid aleatorio.
	const requestId = (env.VERCEL && event.request.headers.get('x-vercel-id')) || randomUUID();
	event.locals.log = logger.child({ requestId });

	const startedAt = performance.now();
	let status = 500;
	// Las probes del kubelet (/healthz, /readyz, issue #124) llegan cada pocos
	// segundos y siempre contestan igual: fuera del log de requests, que si no
	// es puro ruido (el fallo de readiness lo grita igualmente el propio pod).
	const quiet = event.url.pathname === '/healthz' || event.url.pathname === '/readyz';
	try {
		const response = await resolve(event);
		status = response.status;
		return response;
	} finally {
		// `finally`: también se registra cuando la request acaba en error no
		// manejado (SvelteKit convierte el rechazo en respuesta de error después).
		if (!quiet) {
			event.locals.log.info(
				{
					method: event.request.method,
					path: event.url.pathname,
					status,
					durationMs: Math.round(performance.now() - startedAt)
				},
				'request completed'
			);
		}
	}
};

// Errores no manejados de `load`/actions/`+server` que SvelteKit entrega aquí.
// Al log siempre: id de error, tipo y mensaje; el stack solo en dev/preview
// (guía OWASP/Vercel). Al cliente: mensaje genérico con el id, para que pueda
// reportar el fallo sin que se filtre nada interno.
export const handleError: HandleServerError = ({ error, event }) => {
	const errorId = randomUUID();
	const isError = error instanceof Error;
	const withStack = dev || env.VERCEL_ENV === 'preview';
	(event?.locals.log ?? logger).error(
		{
			errorId,
			type: isError ? error.name : typeof error,
			message: isError ? error.message : String(error),
			...(withStack && isError && error.stack ? { stack: error.stack } : {})
		},
		'unhandled error'
	);
	// Mensaje localizado (issue #34). El handleError corre FUERA del contexto de
	// request de Paraglide (SvelteKit lo invoca en su propio catch, por encima
	// de la cadena de handles), así que la locale no puede venir de `getLocale()`:
	// se lee de la request (cookie de Paraglide, o Accept-Language cuando la
	// estrategia la incluya). Con cualquier fallo de lectura, la base.
	let locale: Locale | undefined;
	try {
		locale = extractLocaleFromRequest(event.request);
	} catch {
		// Sin locale legible: `m.*` cae en la base («es»), como antes.
	}
	return { message: m.app_unexpected_error({ id: errorId }, { locale }) };
};

// betterAuthHandle resuelve la sesión una vez por request (event.locals) y
// atiende /api/auth/*; `building` evita resolver sesión durante el prerender y
// `skipAssets` se la ahorra en `/_app/*`, imágenes y fuentes.
// handleAuthGuard (justo después, para ver `locals.user`) exige sesión en todo
// lo demás y manda a /login sin ella: cubre también `+server.ts` y form actions,
// que un guard en `+layout.server.ts` no vería.
// handleFamilyContext (issue #63) resuelve la familia activa del usuario en
// cada request autenticado y la deja en `locals.activeFamily`.
export const handle: Handle = sequence(
	handleLogging,
	handleSecurityHeaders,
	betterAuthHandle(auth, building, { skipAssets: true }),
	handleAuthGuard,
	handleFamilyContext,
	handleUserTrace,
	// Paraglide el último: `/api/auth/*` lo atiende betterAuthHandle antes y no
	// paga el clonado de la request del middleware. Los correos que dispara el
	// auth resuelven su locale de la request por su cuenta (ver
	// `$lib/server/auth.ts` e `invitations.ts`).
	handleParaglide
);
