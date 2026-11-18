import { json } from '@sveltejs/kit';

// Envelope de errores de la API pública /api/v1 (épica #260, tarea #274):
// TODOS los errores comparten la misma forma `{ error: { code, message } }`.
//
// Devuelve la Response en vez de lanzarla: con kit 3, un `error()` lanzado
// llega al cliente como body `App.Error` (`status` y `message` al nivel
// superior del JSON, tras pasar por `handleError`), y no hay forma de que el
// wire sea exactamente el envelope. Devolviéndola, cada `+server.ts` de
// /api/v1 hace `return apiError(...)`, igual que hace `return` del resultado
// de `requireApiUser`, y el JSON de la respuesta es exactamente el envelope.
//
// Minimal a propósito: T5.2 (issue #265) es quien manda en este fichero —
// catálogo de códigos, cabeceras extra (el Retry-After del 429)... — y al ser
// la única puerta de los errores, sus cambios no tocan ningún call site.
/**
 * Construye la respuesta de error de la API con el envelope estandarizado.
 *
 * @param status Código HTTP (401 sin credencial, 403 sin pertenencia, 404
 * recurso ajeno o inexistente, 422 validación, 429 rate limit...).
 * @param code Identificador estable del error para los clientes (`unauthorized`,
 * `not_found`...): los mensajes pueden cambiar, este no.
 * @param message Texto legible, en inglés (mensajes de una API pública).
 */
export function apiError(status: number, code: string, message: string): Response {
	return json({ error: { code, message } }, { status });
}
