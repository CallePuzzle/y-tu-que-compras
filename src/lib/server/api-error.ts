import { API_CONTENT_TYPE, API_HEADERS } from './api-response.js';

// Envelope de errores de la API pública /api/v1 (épica #260, tarea #279):
// TODOS los errores comparten la misma forma `{ error: { code, message } }`
// (más `details` opcional), y este fichero es la ÚNICA puerta por la que salen.
// El schema `Error` de la spec OpenAPI (T6.1, #267) describe exactamente
// `ApiErrorBody`.
//
// Devuelve la Response en vez de lanzarla: con kit 3, un `error()` lanzado
// llega al cliente como body `App.Error` (`message` al nivel superior, tras
// pasar por `handleError`) o como la página de error HTML, según el `Accept`.
// Devolviéndola, cada `+server.ts` de /api/v1 hace `return apiError(...)` y el
// JSON de la respuesta es exactamente el envelope. Lo que no pasa por aquí (404
// de rutas inexistentes, 405, errores no controlados → 500) lo reescribe al
// mismo envelope `handleApiErrors` (`api-errors-handle.ts`) en los hooks.

/**
 * Catálogo cerrado de códigos y su status HTTP. El status sale del código, así
 * que el mapeo es el mismo en toda la API: un endpoint no puede devolver un
 * `not_found` con 400 ni un 401 con otro código.
 */
export const API_ERROR_STATUS = {
	/** Petición mal formada que no cae en otro código. */
	bad_request: 400,
	/** El body de una mutación no es JSON (#272). */
	invalid_json: 400,
	/** Sin `Authorization: Bearer`, o clave inválida, revocada o caducada. */
	unauthenticated: 401,
	/** El usuario del token no es miembro de la familia de la URL. */
	forbidden: 403,
	/** Ruta inexistente, o recurso que no existe o es de otra familia. */
	not_found: 404,
	/** Método HTTP sin handler en la ruta (va con cabecera `Allow`). */
	method_not_allowed: 405,
	/** El body JSON no cumple el schema (errores por campo en `details`). */
	validation_failed: 422,
	/** Exceso de peticiones del token (T5.1, #271). */
	rate_limited: 429,
	/** Error no controlado del servidor (`errorId` en `details` para soporte). */
	internal_error: 500
} as const;

/** Identificador estable de un error de la API: los mensajes pueden cambiar, el código no. */
export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

/** Cabecera `WWW-Authenticate` de todo 401 de la API (RFC 9110 §11.6.1, esquema Bearer de RFC 6750). */
export const API_WWW_AUTHENTICATE = 'Bearer realm="api"';

/** Body JSON de cualquier error de /api/v1. */
export interface ApiErrorBody {
	error: {
		code: ApiErrorCode;
		message: string;
		details?: Record<string, unknown>;
	};
}

export interface ApiErrorOptions {
	/** Detalle legible por máquina (errores por campo del 422, `errorId` del 500...); sin él, la clave no aparece. */
	details?: Record<string, unknown>;
	/** Cabeceras extra (`Allow` del 405, `Retry-After` del 429...). */
	headers?: Record<string, string>;
	/**
	 * Status distinto del del catálogo. Solo para `handleApiErrors`, que
	 * conserva el status de errores que genera kit fuera del catálogo (413,
	 * 415...) envolviéndolos en `bad_request`/`internal_error`. Los endpoints
	 * no lo usan.
	 */
	status?: number;
}

/**
 * Construye la respuesta de error de la API con el envelope estandarizado.
 *
 * @param code Código del catálogo `API_ERROR_STATUS`; fija el status HTTP.
 * @param message Texto legible, en inglés (mensajes de una API pública).
 */
export function apiError(
	code: ApiErrorCode,
	message: string,
	{ details, headers, status = API_ERROR_STATUS[code] }: ApiErrorOptions = {}
): Response {
	const error: ApiErrorBody['error'] =
		details === undefined ? { code, message } : { code, message, details };
	// Mismas cabeceras que los éxitos (charset explícito y `no-store`, #269).
	return Response.json({ error } satisfies ApiErrorBody, {
		status,
		headers: { ...API_HEADERS, ...headers }
	});
}

/** Código del catálogo para un status HTTP cualquiera (para errores que no salen de `apiError`). */
export function apiErrorCodeForStatus(status: number): ApiErrorCode {
	switch (status) {
		case 401:
			return 'unauthenticated';
		case 403:
			return 'forbidden';
		case 404:
			return 'not_found';
		case 405:
			return 'method_not_allowed';
		case 422:
			return 'validation_failed';
		case 429:
			return 'rate_limited';
		default:
			return status >= 500 ? 'internal_error' : 'bad_request';
	}
}

/**
 * ¿Es ya una respuesta de error con el envelope? Solo `apiError` produce
 * respuestas >= 400 con el Content-Type de la API (los éxitos de `apiJson`
 * comparten cabecera pero no status de error).
 */
export function isApiErrorResponse(response: Response): boolean {
	return response.status >= 400 && response.headers.get('content-type') === API_CONTENT_TYPE;
}
