import type { RequestEvent } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '#lib/server/auth.js';

/**
 * Capa de servidor de los tokens de API personales (épica #260, tarea #273).
 * La gestión va por los endpoints del plugin apiKey de better-auth autenticados
 * con la SESIÓN DE COOKIE de quien gestiona (los `headers` de la request),
 * igual que las operaciones de familias con el plugin de tenancy
 * (`families.ts`): el dueño de cada clave lo fija el plugin desde la sesión y
 * el listado y el borrado no cruzan entre usuarios (ante un id ajeno responde
 * NOT_FOUND, indistinguible de uno inexistente).
 *
 * Aquí no hay familia activa que resolver (a diferencia del resto de capas de
 * gestión): los tokens son de la usuaria, no del hogar.
 */

/** Una fila del listado, ya aplanada a lo que la UI enseña. */
export interface ApiTokenRow {
	id: string;
	name: string | null;
	/** Primeros caracteres de la clave que el plugin guarda para reconocerla: lo único de ella que sigue visible tras el alta. */
	start: string | null;
	createdAt: Date;
	/** Última petición autenticada con la clave; `null` si nunca se usó. */
	lastUsedAt: Date | null;
}

/** Los tokens de la usuaria de la sesión, el más nuevo primero. */
export async function listApiTokens(event: RequestEvent): Promise<ApiTokenRow[]> {
	const { apiKeys } = await auth.api.listApiKeys({ headers: event.request.headers });
	return apiKeys
		.map((apiKey) => ({
			id: apiKey.id,
			name: apiKey.name,
			start: apiKey.start,
			createdAt: apiKey.createdAt,
			lastUsedAt: apiKey.lastRequest
		}))
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Crea un token con nombre para la usuaria de la sesión y devuelve la clave EN
 * CLARO junto a su prefijo visible: es lo único que la UI puede mostrar una
 * vez. El plugin guarda solo el hash (SHA-256), así que tras esta llamada
 * nadie —ni esta capa— puede volver a servirla.
 */
export async function createApiToken(
	event: RequestEvent,
	{ name }: { name: string }
): Promise<{ key: string; start: string | null }> {
	const apiKey = await auth.api.createApiKey({ body: { name }, headers: event.request.headers });
	return { key: apiKey.key, start: apiKey.start };
}

/**
 * Revoca (borra) el token cuyo id llega; los demás tokens de la usuaria quedan
 * intactos. Devuelve `false` si el token ya no existe —id rancio, revocado en
 * otra pestaña o ajeno, que el plugin reporta igual— para que la acción dé el
 * mensaje de «no existe» sin filtrar nada.
 */
export async function revokeApiToken(event: RequestEvent, id: string): Promise<boolean> {
	try {
		await auth.api.deleteApiKey({ body: { keyId: id }, headers: event.request.headers });
		return true;
	} catch (error) {
		if (error instanceof APIError && error.status === 'NOT_FOUND') {
			return false;
		}
		throw error;
	}
}
