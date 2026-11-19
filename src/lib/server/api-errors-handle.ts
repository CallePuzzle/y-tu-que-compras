import { randomUUID } from 'node:crypto';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

import { apiError, apiErrorCodeForStatus, isApiErrorResponse } from './api-error.js';
import logger from './logger.js';

// Red de seguridad del envelope de errores de /api/v1 (épica #260, tarea #279).
//
// Los endpoints devuelven sus errores con `apiError`, pero hay respuestas de
// error que no salen de ningún `+server.ts`: las genera kit — 404 de una ruta
// inexistente, 405 de un método sin handler — o vienen de un error no
// controlado (excepción en un endpoint → `handleError` → 500). Kit las sirve
// como texto, JSON `App.Error` o la página de error HTML según el `Accept`.
// Este handle las reescribe todas al envelope `{ error: { code, message } }`
// para que CUALQUIER error de la API tenga el mismo shape y Content-Type.

/** Prefijo de la API pública. `/api/v1` a secas no es una ruta de la API (el guard de sesión la trata como web). */
const API_PREFIX = '/api/v1/';

/** Mensajes genéricos por código para las respuestas que no salen de `apiError`. */
const GENERIC_MESSAGES = {
	not_found: 'Not found',
	internal_error: 'Internal server error'
} as const;

/** ¿Es una ruta de la API pública? */
export function isApiPathname(pathname: string): boolean {
	return pathname.startsWith(API_PREFIX);
}

/** 500 con el `errorId` que `handleError` (o este handle) dejó en el log, para poder reportarlo. */
function internalError(errorId: string | undefined, status = 500): Response {
	return apiError('internal_error', GENERIC_MESSAGES.internal_error, {
		status,
		...(errorId ? { details: { errorId } } : {})
	});
}

/** Reescribe al envelope una respuesta de error que no lo lleva. */
export function toApiErrorResponse(
	response: Response,
	method: string,
	errorId: string | undefined
): Response {
	const { status } = response;
	const code = apiErrorCodeForStatus(status);
	switch (code) {
		case 'internal_error':
			return internalError(errorId, status);
		case 'not_found':
			return apiError(code, GENERIC_MESSAGES.not_found);
		case 'method_not_allowed': {
			const allow = response.headers.get('allow');
			return apiError(code, `Method ${method} not allowed`, {
				...(allow ? { headers: { allow } } : {})
			});
		}
		default:
			// 401/403/413/415... generados fuera de los endpoints (p. ej. el
			// check CSRF de kit): se conserva el status y se usa el texto
			// estándar del status si no hay otro mejor.
			return apiError(code, response.statusText || `Request failed with status ${status}`, {
				status
			});
	}
}

/**
 * Handle de los hooks: en `/api/v1/**`, cualquier respuesta de error que no
 * venga ya con el envelope se reescribe a él, y una excepción que suba por la
 * cadena de handles acaba en el mismo 500 JSON (con su `errorId` en el log).
 * Fuera de la API no hace nada.
 */
export const handleApiErrors: Handle = async ({ event, resolve }) => {
	if (!isApiPathname(event.url.pathname)) {
		return resolve(event);
	}

	let response: Response;
	try {
		response = await resolve(event);
	} catch (error) {
		// `redirect()`/`error()` de kit no son fallos del servidor: se relanzan
		// para que kit responda con su status (3xx/4xx) en vez de un 500.
		if (isRedirect(error) || isHttpError(error)) throw error;
		// Una excepción de un handle posterior: kit la convertiría fuera de esta
		// cadena (y sin envelope). Se registra como haría `handleError`.
		const errorId = randomUUID();
		const isError = error instanceof Error;
		(event.locals.log ?? logger).error(
			{
				errorId,
				type: isError ? error.name : typeof error,
				message: isError ? error.message : String(error)
			},
			'unhandled error'
		);
		return internalError(errorId);
	}

	if (response.status < 400 || isApiErrorResponse(response)) {
		return response;
	}
	return toApiErrorResponse(response, event.request.method, event.locals.errorId);
};
