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

/** Lo que `requireApiUser` entrega al endpoint: la autenticación o la 401 lista para devolver.

 * El corte NO lanza un `error()` de kit: su body viajaría con `status` y
 * `message` propios de `App.Error` al nivel superior, ensuciando el envelope
 * `{ error: { code, message } }` (ver `api-error.ts`). Con el resultado en la
 * mano el endpoint hace `if (!result.ok) return result.response;` y la 401
 * sale ANTES de tocar la lógica de dominio — que es justo el criterio de
 * aceptación de la tarea.
 */
export type ApiUserResult =
	{ ok: true; userId: string; key: ApiKeyRecord } | { ok: false; response: Response };

/** Código estable del 401: sin cabecera, clave inválida, revocada o caducada comparten envelope; el matiz queda en el log. */
const UNAUTHORIZED_CODE = 'unauthorized';

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
	return { ok: false, response: apiError(401, UNAUTHORIZED_CODE, UNAUTHORIZED_MESSAGE) };
}

/**
 * Autenticación compartida por TODOS los endpoints /api/v1: resuelve el
 * Bearer de `Authorization` con `auth.api.verifyApiKey` y devuelve el dueño
 * de la clave con su registro verificado (`{ ok: true, userId, key }`), o el
 * 401 JSON (`{ ok: false, response }`) que el endpoint devuelve sin entrar en
 * su lógica. La pertenencia a la familia NO se mira aquí: esa (403) es de
 * cada endpoint, con el `familyId` de la URL.
 *
 * La verificación es la del plugin (hash SHA-256 + `enabled` + `expiresAt` +
 * límite de peticiones por clave), así que revocar o caducar una clave desde
 * la app invalida el acceso a la API sin más estado en medio. El 429 por
 * abuso de clave lo afinará T5.1 (issue #265) sobre este mismo punto de
 * corte; hoy el plugin lo degrada al mismo 401.
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
		return unauthorized(event, verified.error.code);
	}
	// Defensivo: el tipo del éxito deja `key: … | null` (en la práctica siempre
	// viene), y el userId sale de él.
	if (!verified.valid || !verified.key) {
		return unauthorized(event, 'invalid_api_key');
	}

	return { ok: true, userId: verified.key.referenceId, key: verified.key };
}
