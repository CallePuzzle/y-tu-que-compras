import { fail } from '@sveltejs/kit';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { m } from '#lib/paraglide/messages.js';
import { categorySchema } from '#lib/schemas/category.js';
import {
	CategoryExistsError,
	createCategory,
	deleteCategory,
	listCategories,
	reorderCategories,
	updateCategory
} from '#lib/server/categories.js';
import { requireActiveFamily } from '#lib/server/family-context.js';
import logger from '#lib/server/logger.js';
import type { Actions, PageServerLoad } from './$types';

// La página de categorías (issue #170) consume la capa de servidor de la #169:
// aquí no hay lógica de datos, solo traducir la familia activa, el schema y el
// `CategoryExistsError` a superforms y mensajes de UI. Los schemas se
// construyen EN REQUEST, nunca en scope de módulo (regla i18n de la librería):
// los textos de Paraglide se resuelven con la locale de la petición.
function categoryFormSchema() {
	return categorySchema({
		nameError: m.schema_categories_name_error(),
		nameLabel: m.schema_categories_name_label(),
		namePlaceholder: m.schema_categories_name_placeholder()
	});
}

/** Valores iniciales del formulario: nombre vacío, como el alta de listas. */
const EMPTY_CATEGORY = { name: '' } as const;

// La familia activa es la puerta de la vista (issue #63): `requireActiveFamily`
// manda a `/families` a quien no tiene o no ha elegido, y su id — ya
// verificado contra la membresía — es el que filtra TODAS las queries.
export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);
	return {
		form: await superValidate(EMPTY_CATEGORY, zod4(categoryFormSchema())),
		categories: await listCategories(family.id)
	};
};

/**
 * El id de la categoría que viaja en el formulario (input hidden de editar,
 * borrar y mover). `null` si falta: UI rancia o petición hecha a mano.
 *
 * Recibe el FormData YA LEÍDO: `request.formData()` solo se puede consumir
 * una vez, y la acción de editar llama también a `superValidate` con él —
 * dos lecturas lanzan «Body already used» y la acción entera cae con un 500.
 */
function categoryIdOf(data: FormData): string | null {
	const id = data.get('categoryId');
	return typeof id === 'string' && id ? id : null;
}

export const actions: Actions = {
	// Crear: el schema valida el nombre y `createCategory` detecta el duplicado
	// sobre el nombre normalizado EN LA BASE (capa #169), a prueba de carreras.
	// El `CategoryExistsError` se traduce a un mensaje claro dentro del modal,
	// sin filtrar el fallo crudo de Prisma.
	create: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(categoryFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		try {
			await createCategory(family.id, form.data);
		} catch (error) {
			if (error instanceof CategoryExistsError) {
				return message(form, m.categories_duplicate(), { status: 409 });
			}
			logger.error({ err: error }, 'Error al crear la categoría');
			// Fallo inesperado (BD caída, columna…): 5xx, que el cliente y la
			// monitorización lo vean como lo que es (issue #110). Lo mismo en
			// los demás catch de acciones.
			return message(form, m.categories_error(), { status: 500 });
		}

		return message(form, m.categories_success());
	},

	// Editar: mismo schema que crear (el campo es el mismo). El FormData se lee
	// UNA vez y alimenta al superforms y al id oculto (el body del request no
	// se puede consumir dos veces). `updateCategory` solo toca categorías DE LA
	// FAMILIA ACTIVA: un id ajeno o ya borrado llega como «no existe», sin
	// revelar si está en otra familia.
	update: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const form = await superValidate(data, zod4(categoryFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		const id = categoryIdOf(data);
		if (!id) {
			return message(form, m.categories_gone(), { status: 400 });
		}

		try {
			const updated = await updateCategory(family.id, id, form.data);
			if (!updated) {
				// Ya no existe (id rancio o borrada por otro miembro): 404, no
				// 400 — el recurso que pide tocar es otro que ya no está.
				return message(form, m.categories_gone(), { status: 404 });
			}
		} catch (error) {
			if (error instanceof CategoryExistsError) {
				return message(form, m.categories_duplicate(), { status: 409 });
			}
			logger.error({ err: error }, 'Error al actualizar la categoría');
			return message(form, m.categories_error(), { status: 500 });
		}

		return message(form, m.categories_updated());
	},

	// Borrar: confirmación en la UI (`ConfirmModal`). Los items y productos que
	// la usaban NO se borran: sus FKs son `SetNull` (épica #164). Mismo trato
	// de «no existe aquí» que editar.
	delete: async (event) => {
		const family = requireActiveFamily(event);
		const id = categoryIdOf(await event.request.formData());
		if (!id) {
			return fail(400, { error: m.categories_error() });
		}

		try {
			const deleted = await deleteCategory(family.id, id);
			if (!deleted) {
				return fail(404, { error: m.categories_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al borrar la categoría');
			return fail(500, { error: m.categories_error() });
		}

		return { success: true };
	},

	// Mover (el «listado ordenable» de la checklist): el cliente solo dice QUÉ
	// categoría y en QUÉ dirección; el orden nuevo se calcula en el SERVIDOR
	// desde el que tiene la base y `reorderCategories` lo reescribe entero —
	// nadie manda posiciones sueltas desde el cliente (contrato de la #169).
	// Subir la primera o bajar la última no es error: la fila ya está donde
	// podía estar (la UI deshabilita el botón, pero sin JS la acción tampoco
	// rompe si llega).
	move: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const id = categoryIdOf(data);
		if (!id) {
			return fail(400, { error: m.categories_error() });
		}
		const movingUp = data.get('direction') !== 'down';

		const categories = await listCategories(family.id);
		const index = categories.findIndex((category) => category.id === id);
		if (index === -1) {
			// Id rancio o ajeno a la familia: 404, como en editar y borrar.
			return fail(404, { error: m.categories_gone() });
		}
		if (movingUp ? index === 0 : index === categories.length - 1) {
			return { success: true };
		}

		const orderedIds = categories.map((category) => category.id);
		const neighbor = movingUp ? orderedIds[index - 1] : orderedIds[index + 1];
		if (!neighbor) {
			return { success: true };
		}
		orderedIds[movingUp ? index - 1 : index + 1] = id;
		orderedIds[index] = neighbor;

		try {
			await reorderCategories(family.id, orderedIds);
		} catch (error) {
			logger.error({ err: error }, 'Error al reordenar las categorías');
			return fail(500, { error: m.categories_error() });
		}

		return { success: true };
	}
};
