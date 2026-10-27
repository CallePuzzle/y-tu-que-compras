import { fail } from '@sveltejs/kit';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { m } from '$lib/paraglide/messages.js';
import { listSchema } from '$lib/schemas/list.js';
import { requireActiveFamily } from '$lib/server/family-context.js';
import { createList, deleteList, listLists, updateList } from '$lib/server/lists.js';
import logger from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

// Los schemas se construyen EN REQUEST, nunca en scope de módulo (regla i18n
// de la librería): los textos de Paraglide se resuelven con la locale de la
// petición.
function listFormSchema() {
	return listSchema({
		nameError: m.schema_lists_name_error(),
		nameLabel: m.schema_lists_name_label(),
		namePlaceholder: m.schema_lists_name_placeholder(),
		colorError: m.schema_lists_color_error(),
		colorLabel: m.schema_lists_color_label(),
		iconError: m.schema_lists_icon_error(),
		iconLabel: m.schema_lists_icon_label()
	});
}

/**
 * Valores iniciales del formulario: nombre vacío y la primera opción de cada
 * catálogo, para que los selectores de color e icono abran con algo elegido
 * (la familia siempre puede cambiarlos antes de guardar).
 */
const EMPTY_LIST = { name: '', color: 'primary', icon: 'shopping-basket' } as const;

// La familia activa es la puerta de la vista (issue #63): `requireActiveFamily`
// manda a `/families` a quien no tiene o no ha elegido, y su id — ya
// verificado contra la membresía — es el que filtra TODAS las queries.
export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);
	return {
		form: await superValidate(EMPTY_LIST, zod4(listFormSchema())),
		lists: await listLists(family.id)
	};
};

/**
 * El id de la lista que viaja en el formulario (input hidden de editar y
 * borrar). `null` si falta: UI rancia o petición hecha a mano.
 *
 * Recibe el FormData YA LEÍDO: `request.formData()` solo se puede consumir
 * una vez, y la acción de editar llama también a `superValidate` con él —
 * dos lecturas lanzan «Body already used» y la acción entera cae con un 500.
 */
function listIdOf(data: FormData): string | null {
	const id = data.get('lista');
	return typeof id === 'string' && id ? id : null;
}

export const actions: Actions = {
	// Crear (checklist #66): los datos ya vienen validados por el schema; el id
	// de familia lo pone el SERVIDOR (la activa), nunca el cliente.
	create: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(listFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		try {
			await createList(family.id, form.data);
		} catch (error) {
			logger.error({ err: error }, 'Error al crear la lista');
			return message(form, m.lists_error(), { status: 400 });
		}

		return message(form, m.lists_success());
	},

	// Editar (checklist #66): mismo schema que crear (los campos son los
	// mismos). El FormData se lee UNA vez y alimenta al superforms y al id
	// oculto (el body del request no se puede consumir dos veces). `updateList`
	// solo toca listas DE LA FAMILIA ACTIVA: un id ajeno o ya borrado llega
	// como «no existe», sin revelar si está en otra familia.
	update: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const form = await superValidate(data, zod4(listFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		const id = listIdOf(data);
		if (!id) {
			return message(form, m.lists_gone(), { status: 400 });
		}

		try {
			const updated = await updateList(family.id, id, form.data);
			if (!updated) {
				return message(form, m.lists_gone(), { status: 400 });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al actualizar la lista');
			return message(form, m.lists_error(), { status: 400 });
		}

		return message(form, m.lists_updated());
	},

	// Borrar (checklist #66): confirmación en la UI; la cascada de items será
	// FK cuando existan (issue #67). Mismo trato de «no existe aquí» que editar.
	delete: async (event) => {
		const family = requireActiveFamily(event);
		const id = listIdOf(await event.request.formData());
		if (!id) {
			return fail(400, { error: m.lists_error() });
		}

		try {
			const deleted = await deleteList(family.id, id);
			if (!deleted) {
				return fail(400, { error: m.lists_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al borrar la lista');
			return fail(400, { error: m.lists_error() });
		}

		return { success: true };
	}
};
