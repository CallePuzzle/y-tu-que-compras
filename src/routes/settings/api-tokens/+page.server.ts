import { fail } from '@sveltejs/kit';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { m } from '#lib/paraglide/messages.js';
import { apiTokenCreateSchema } from '#lib/schemas/api-token.js';
import { createApiToken, listApiTokens, revokeApiToken } from '#lib/server/api-tokens.js';
import logger from '#lib/server/logger.js';
import type { Actions, PageServerLoad } from './$types';

// La página de ajustes de tokens de API (épica #260, tarea #273): aquí no hay
// lógica de datos —la maneja el plugin apiKey vía `#lib/server/api-tokens.ts`—,
// solo traducir el schema y los errores a superforms y mensajes de UI. Los
// schemas se construyen EN REQUEST, nunca en scope de módulo (regla i18n de la
// librería): los textos de Paraglide se resuelven con la locale de la petición.
function apiTokenFormSchema() {
	return apiTokenCreateSchema({
		nameError: m.schema_settings_api_tokens_name_error(),
		nameLabel: m.schema_settings_api_tokens_name_label(),
		namePlaceholder: m.schema_settings_api_tokens_name_placeholder()
	});
}

/** Valores iniciales del formulario: nombre vacío. */
const EMPTY_TOKEN = { name: '' } as const;

// Los tokens son PERSONALES (los endpoints del plugin atienden a la sesión de
// cookie): no hay familia activa que resolver, a diferencia del resto de
// vistas de gestión. El guard de hooks ya exige sesión para llegar aquí.
export const load: PageServerLoad = async (event) => {
	return {
		form: await superValidate(EMPTY_TOKEN, zod4(apiTokenFormSchema())),
		tokens: await listApiTokens(event)
	};
};

/**
 * El id del token que viaja en el formulario (input hidden de revocar).
 * `null` si falta: UI rancia o petición hecha a mano.
 *
 * Recibe el FormData YA LEÍDO: `request.formData()` solo se puede consumir
 * una vez (mismo motivo en las acciones de categorías).
 */
function apiTokenIdOf(data: FormData): string | null {
	const id = data.get('tokenId');
	return typeof id === 'string' && id ? id : null;
}

export const actions: Actions = {
	// Crear: el schema valida el nombre y el plugin genera la clave, la hashea
	// y la guarda. La clave en claro SOLO existe en esta respuesta: la página
	// la muestra una vez con su aviso y no queda en ningún estado de servidor
	// ni log (el plugin solo persiste el hash).
	create: async (event) => {
		const form = await superValidate(event.request, zod4(apiTokenFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		try {
			const token = await createApiToken(event, { name: form.data.name });
			return {
				form,
				apiKey: { key: token.key, start: token.start, name: form.data.name }
			};
		} catch (error) {
			logger.error({ err: error }, 'Error al crear el token de API');
			// Fallo inesperado (BD caída…): 5xx, que el cliente y la monitorización
			// lo vean como lo que es (issue #110).
			return message(form, m.settings_api_tokens_error(), { status: 500 });
		}
	},

	// Revocar: confirmación en la UI (`ConfirmModal`). Los ids rancios o ajenos
	// llegan como «no existe» (el plugin no distingue), 404 como en el resto de
	// acciones de la app.
	revoke: async (event) => {
		const id = apiTokenIdOf(await event.request.formData());
		if (!id) {
			return fail(400, { error: m.settings_api_tokens_error() });
		}

		try {
			const revoked = await revokeApiToken(event, id);
			if (!revoked) {
				return fail(404, { error: m.settings_api_tokens_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al revocar el token de API');
			return fail(500, { error: m.settings_api_tokens_error() });
		}

		return { success: true };
	}
};
