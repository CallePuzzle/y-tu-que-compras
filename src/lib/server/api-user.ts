import type { RequestEvent } from '@sveltejs/kit';

import { apiError } from './api-error.js';
import { auth } from './auth.js';
import logger from './logger.js';

// Autenticación de la API pública /api/v1 (épica #260, tarea #274): Bearer
// token del plugin apiKey, SIN cookies de sesión. La web usa `locals.user`
// (lo deja `betterAuthHandle` desde la cookie de better-auth) y familia
// activa en cookie (`requireActiveFamily`); la API ignora ambas de
// propósito: aquí la única credencial válida es la cabecera
// `Authorization: Bearer <clave de API>`, verificada contra la tabla
// `apikey` (hash SHA-256 del plugin) con `auth.api.verifyApiKey`. Así un
// navegador con sesión abierta no gana acceso a la API por la cara.

type VerifyApiKeyResponse = Awaited<ReturnType<typeof auth.api.verifyApiKey>>;

// El brazo de éxito se reconoce por `error: null`: el plugin tipa `valid`
// como `boolean` plano (sin literal), así que no es discriminante y hay que
// extraer por el error.
type VerifiedApiKeyResponse = Extract<VerifyApiKeyResponse, { error: null }>;

/** Registro de una clave de API verificada (el `key` del éxito del plugin: el hash de la clave nunca sale de la BD). */
export type ApiKeyRecord = NonNullable<VerifiedApiKeyResponse['key']>;

/** Lo que `requireApiUser` entrega al endpoint: la autenticación o la 401/429 lista para devolver.

 * El corte NO lanza un `error()` de kit: su body viajaría con `status` y
 * `message` propios de `App.Error` al nivel superior, ensuciando el envelope
 * `{ error: { code, message } }` (ver `api-error.ts`). Con el resultado en la
 * mano el endpoint hace `if (!result.ok) return result.response;` y la 401
 * sale ANTES de tocar la lógica de dominio — que es justo el criterio de
 * aceptación de la tarea.
 */
export type ApiUserResult =
	{ ok: true; userId: string; key: ApiKeyRecord } | { ok: false; response: Response };

/** Mensaje único para todo 401: ni revocada ni caducada revelan más de la cuenta. */
const UNAUTHORIZED_MESSAGE = 'Missing or invalid API key';

/**
 * 401 con el envelope de `apiError`. La causa fina (código del plugin:
 * `KEY_NOT_FOUND`, `KEY_DISABLED`, `KEY_EXPIRED`...) solo va al log del
 * request (`requestId` incluido), para depurar integraciones sin filtrar
 * matices al cliente.
 */
function unauthorized(event: RequestEvent, reason: string): { ok: false; response: Response } {
	// `handleLogging` lo crea siempre en cada request; el fallback cubre las
	// llamadas fuera del ciclo de request (los specs).
	(event.locals.log ?? logger).info({ api_key_rejected: reason }, UNAUTHORIZED_MESSAGE);
	return { ok: false, response: apiError('unauthenticated', UNAUTHORIZED_MESSAGE) };
}

/**
 * Código con el que el plugin apiKey reporta una clave que agotó su límite de
 * peticiones (`APIError` TOO_MANY_REQUESTS con `details.tryAgainIn` en ms,
 * que `verifyApiKey` devuelve aplanado en `error`).
 */
const RATE_LIMITED_CODE = 'RATE_LIMITED';

const RATE_LIMITED_MESSAGE = 'Rate limit exceeded for this API key';

/**
 * Segundos de `Retry-After` a partir del `tryAgainIn` (ms) del plugin:
 * redondeo hacia arriba (reintentar antes de tiempo volvería a dar 429) y
 * nunca menos de 1. Si el plugin no lo trae (no debería), 60 s: el orden de
 * magnitud de la ventana configurada.
 */
export function retryAfterSeconds(tryAgainInMs: unknown): number {
	if (typeof tryAgainInMs !== 'number' || !Number.isFinite(tryAgainInMs)) {
		return 60;
	}
	return Math.max(1, Math.ceil(tryAgainInMs / 1000));
}

/**
 * 429 con el envelope y `Retry-After` (segundos, RFC 9110). La clave es
 * válida —es su dueña quien se pasa del límite—, así que la espera sí se
 * comunica: el cliente sabe cuándo reintentar. `details.retryAfter` repite
 * los segundos en el body para clientes que no miran cabeceras.
 */
function rateLimited(event: RequestEvent, error: object): { ok: false; response: Response } {
	// El tipo del plugin no declara `details`, pero el `APIError` del límite
	// lo trae (el verify esparce `error.body` en la respuesta).
	const details = 'details' in error ? (error.details as { tryAgainIn?: unknown }) : undefined;
	const retryAfter = retryAfterSeconds(details?.tryAgainIn);
	(event.locals.log ?? logger).info(
		{ api_key_rejected: RATE_LIMITED_CODE, retryAfter },
		RATE_LIMITED_MESSAGE
	);
	return {
		ok: false,
		response: apiError('rate_limited', RATE_LIMITED_MESSAGE, {
			details: { retryAfter },
			headers: { 'retry-after': String(retryAfter) }
		})
	};
}

/**
 * Autenticación compartida por TODOS los endpoints /api/v1: resuelve el
 * Bearer de `Authorization` con `auth.api.verifyApiKey` y devuelve el dueño
 * de la clave con su registro verificado (`{ ok: true, userId, key }`), o el
 * 401/429 JSON (`{ ok: false, response }`) que el endpoint devuelve sin entrar en
 * su lógica. La pertenencia a la familia NO se mira aquí: esa (403) es de
 * cada endpoint, con el `familyId` de la URL.
 *
 * La verificación es la del plugin (hash SHA-256 + `enabled` + `expiresAt` +
 * límite de peticiones por clave), así que revocar o caducar una clave desde
 * la app invalida el acceso a la API sin más estado en medio. Una clave
 * VÁLIDA que agota su límite (T5.1, #271; configurado en `auth.ts`) no es un
 * 401 sino un 429 `rate_limited` con `Retry-After` (ver `rateLimited`).
 */
export async function requireApiUser(event: RequestEvent): Promise<ApiUserResult> {
	// Esquema insensible a mayúsculas (RFC 7235), un solo token, sin resto.
	const token = event.request.headers.get('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
	if (!token) {
		return unauthorized(event, 'missing_bearer_token');
	}

	const verified = await auth.api.verifyApiKey({ body: { key: token } });
	// Un fallo inesperado aquí (BD caída) se propaga: kit lo convertirá en un
	// 500 vía `handleError`, que es lo correcto para un error de servidor —
	// no tiene nada que ver con un 401 de credencial.
	// Se estrecha por `error` (ver `VerifiedApiKeyResponse`): `valid` no es
	// discriminante en el tipo del plugin.
	if (verified.error) {
		if (verified.error.code === RATE_LIMITED_CODE) {
			return rateLimited(event, verified.error);
		}
		return unauthorized(event, verified.error.code);
	}
	// Defensivo: el tipo del éxito deja `key: … | null` (en la práctica siempre
	// viene), y el userId sale de él.
	if (!verified.valid || !verified.key) {
		return unauthorized(event, 'invalid_api_key');
	}

	return { ok: true, userId: verified.key.referenceId, key: verified.key };
}
