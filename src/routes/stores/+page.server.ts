import { fail } from '@sveltejs/kit';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { m } from '#lib/paraglide/messages.js';
import { storeSchema } from '#lib/schemas/store.js';
import { requireActiveFamily } from '#lib/server/family-context.js';
import logger from '#lib/server/logger.js';
import {
	StoreExistsError,
	createStore,
	deleteStore,
	listStores,
	updateStore
} from '#lib/server/stores.js';
import type { Actions, PageServerLoad } from './$types';

// La página de establecimientos (issue #183) consume la capa de servidor de la
// #182: aquí no hay lógica de datos, solo traducir la familia activa, el schema
// y el `StoreExistsError` a superforms y mensajes de UI. Los schemas se
// construyen EN REQUEST, nunca en scope de módulo (regla i18n de la librería):
// los textos de Paraglide se resuelven con la locale de la petición.
function storeFormSchema() {
	return storeSchema({
		nameError: m.schema_stores_name_error(),
		nameLabel: m.schema_stores_name_label(),
		namePlaceholder: m.schema_stores_name_placeholder()
	});
}

/** Valores iniciales del formulario: nombre vacío, como el alta de listas. */
const EMPTY_STORE = { name: '' } as const;

// La familia activa es la puerta de la vista (issue #63): `requireActiveFamily`
// manda a `/families` a quien no tiene o no ha elegido, y su id — ya
// verificado contra la membresía — es el que filtra TODAS las queries.
export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);
	return {
		form: await superValidate(EMPTY_STORE, zod4(storeFormSchema())),
		stores: await listStores(family.id)
	};
};

/**
 * El id del establecimiento que viaja en el formulario (input hidden de editar
 * y borrar). `null` si falta: UI rancia o petición hecha a mano.
 *
 * Recibe el FormData YA LEÍDO: `request.formData()` solo se puede consumir
 * una vez, y la acción de editar llama también a `superValidate` con él —
 * dos lecturas lanzan «Body already used» y la acción entera cae con un 500.
 */
function storeIdOf(data: FormData): string | null {
	const id = data.get('storeId');
	return typeof id === 'string' && id ? id : null;
}

export const actions: Actions = {
	// Crear: el schema valida el nombre y `createStore` detecta el duplicado
	// sobre el nombre normalizado EN LA BASE (capa #182), a prueba de carreras.
	// El `StoreExistsError` se traduce a un mensaje claro dentro del modal,
	// sin filtrar el fallo crudo de Prisma.
	create: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(storeFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		try {
			await createStore(family.id, form.data);
		} catch (error) {
			if (error instanceof StoreExistsError) {
				return message(form, m.stores_duplicate(), { status: 409 });
			}
			logger.error({ err: error }, 'Error al crear el establecimiento');
			// Fallo inesperado (BD caída, columna…): 5xx, que el cliente y la
			// monitorización lo vean como lo que es (issue #110). Lo mismo en
			// los demás catch de acciones.
			return message(form, m.stores_error(), { status: 500 });
		}

		return message(form, m.stores_success());
	},

	// Editar: mismo schema que crear (el campo es el mismo). El FormData se lee
	// UNA vez y alimenta al superforms y al id oculto (el body del request no
	// se puede consumir dos veces). `updateStore` solo toca establecimientos
	// DE LA FAMILIA ACTIVA: un id ajeno o ya borrado llega como «no existe»,
	// sin revelar si está en otra familia.
	update: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const form = await superValidate(data, zod4(storeFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		const id = storeIdOf(data);
		if (!id) {
			return message(form, m.stores_gone(), { status: 400 });
		}

		try {
			const updated = await updateStore(family.id, id, form.data);
			if (!updated) {
				// Ya no existe (id rancio o borrado por otro miembro): 404, no
				// 400 — el recurso que pide tocar es otro que ya no está.
				return message(form, m.stores_gone(), { status: 404 });
			}
		} catch (error) {
			if (error instanceof StoreExistsError) {
				return message(form, m.stores_duplicate(), { status: 409 });
			}
			logger.error({ err: error }, 'Error al actualizar el establecimiento');
			return message(form, m.stores_error(), { status: 500 });
		}

		return message(form, m.stores_updated());
	},

	// Borrar: confirmación en la UI (`ConfirmModal`). Las compras del historial
	// NO se borran: su FK es `SetNull` (épica #177, tarea #179) y conservan el
	// nombre congelado en `storeName`. Mismo trato de «no existe aquí» que
	// editar.
	delete: async (event) => {
		const family = requireActiveFamily(event);
		const id = storeIdOf(await event.request.formData());
		if (!id) {
			return fail(400, { error: m.stores_error() });
		}

		try {
			const deleted = await deleteStore(family.id, id);
			if (!deleted) {
				return fail(404, { error: m.stores_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al borrar el establecimiento');
			return fail(500, { error: m.stores_error() });
		}

		return { success: true };
	}
};
