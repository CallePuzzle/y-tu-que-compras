import { z } from 'zod/v4';

import { apiError } from './api-error.js';

// Lectura y validación del body JSON de las mutaciones de /api/v1 (épica #260,
// tarea #272). Mismo patrón que `requireApiUser`: devuelve un resultado
// discriminado y el handler hace `if (!body.ok) return body.response;`.
//
// - Body que no es JSON → 400 `invalid_json` (no hay nada que validar).
// - JSON que no cumple el schema → 422 `validation_failed`, con los errores
//   por campo en `details` (`{ campo: [mensajes] }`, `z.flattenError`). Los
//   schemas se instancian sin textos i18n, así que los mensajes son los de zod
//   por defecto, en inglés como el resto de la API.

export type ApiBodyResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Valida `value` (ya parseado) contra `schema`: 422 con errores por campo si no cumple. */
export function validateApiBody<S extends z.ZodType>(
	schema: S,
	value: unknown
): ApiBodyResult<z.infer<S>> {
	const parsed = schema.safeParse(value);
	if (parsed.success) {
		return { ok: true, data: parsed.data };
	}
	const { formErrors, fieldErrors } = z.flattenError(parsed.error);
	const details: Record<string, unknown> = { ...fieldErrors };
	// Errores sin campo (body que no es un objeto, refinamientos globales).
	if (formErrors.length > 0) {
		details._errors = formErrors;
	}
	return {
		ok: false,
		response: apiError('validation_failed', 'Invalid request body', { details })
	};
}

/** Lee el body JSON de la petición y lo valida contra `schema`. */
export async function readApiBody<S extends z.ZodType>(
	request: Request,
	schema: S
): Promise<ApiBodyResult<z.infer<S>>> {
	let value: unknown;
	try {
		value = await request.json();
	} catch {
		return { ok: false, response: apiError('invalid_json', 'Request body must be JSON') };
	}
	return validateApiBody(schema, value);
}
