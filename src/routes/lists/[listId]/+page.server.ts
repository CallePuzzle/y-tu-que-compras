import { fail, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { m } from '$lib/paraglide/messages.js';
import { itemSchema } from '$lib/schemas/item.js';
import { requireActiveFamily } from '$lib/server/family-context.js';
import {
	createItem,
	deleteItem,
	listItems,
	setItemPurchased,
	updateItem
} from '$lib/server/items.js';
import { getList } from '$lib/server/lists.js';
import logger from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

// Los schemas se construyen EN REQUEST, nunca en scope de módulo (regla i18n
// de la librería): los textos de Paraglide se resuelven con la locale de la
// petición.
function itemFormSchema() {
	return itemSchema({
		nameError: m.schema_items_name_error(),
		nameLabel: m.schema_items_name_label(),
		namePlaceholder: m.schema_items_name_placeholder(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.schema_items_quantity_label(),
		unitError: m.schema_items_unit_error(),
		unitLabel: m.schema_items_unit_label()
	});
}

/**
 * Valores iniciales del alta rápida: cantidad 1 y unidad «ud», lo más común
 * en la compra, para que añadir cueste lo menos posible desde el móvil.
 */
const EMPTY_ITEM = { name: '', quantity: 1, unit: 'unit' } as const;

// El alta rápida y el modal de edición llevan cada uno SU formulario de
// superforms (en la página hay dos a la vez): ids distintos para que cada uno
// aplique solo el resultado de su acción.
const EDIT_FORM_ID = 'edit-item';

export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);

	// Lista inexistente o ajena (enlace rancio, lista borrada en otro
	// dispositivo): de vuelta al listado, como en /families/[familyId].
	const list = await getList(family.id, event.params.listId);
	if (!list) {
		redirect(302, '/lists');
	}

	return {
		list,
		items: await listItems(family.id, event.params.listId),
		form: await superValidate(EMPTY_ITEM, zod4(itemFormSchema())),
		editForm: await superValidate(EMPTY_ITEM, zod4(itemFormSchema()), { id: EDIT_FORM_ID })
	};
};

/**
 * El id del item que viaja en el formulario (input hidden de editar y
 * borrar). `null` si falta: UI rancia o petición hecha a mano.
 */
async function itemIdOf(event: RequestEvent): Promise<string | null> {
	const id = (await event.request.formData()).get('item');
	return typeof id === 'string' && id ? id : null;
}

export const actions: Actions = {
	// Alta rápida (checklist #68): los datos ya vienen validados por el schema;
	// la lista y el `order` los pone el SERVIDOR, nunca el cliente.
	create: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(itemFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		try {
			const created = await createItem(family.id, event.params.listId, form.data);
			if (!created) {
				return message(form, m.lists_gone(), { status: 400 });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al crear el item');
			return message(form, m.items_error(), { status: 400 });
		}

		return message(form, m.items_success());
	},

	// Editar (checklist #68): mismo schema que crear (los campos son los
	// mismos). `updateItem` solo toca items de listas DE LA FAMILIA ACTIVA: un
	// id ajeno o ya borrado llega como «no existe», sin revelar si está en
	// otra familia.
	update: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(itemFormSchema()), {
			id: EDIT_FORM_ID
		});
		if (!form.valid) {
			return fail(400, { form });
		}

		const id = await itemIdOf(event);
		if (!id) {
			return message(form, m.items_gone(), { status: 400 });
		}

		try {
			const updated = await updateItem(family.id, event.params.listId, id, form.data);
			if (!updated) {
				return message(form, m.items_gone(), { status: 400 });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al actualizar el item');
			return message(form, m.items_error(), { status: 400 });
		}

		return message(form, m.items_updated());
	},

	// Borrar (checklist #68): confirmación en la UI. Sin schema de superforms
	// (solo el id oculto), como el borrado de listas.
	delete: async (event) => {
		const family = requireActiveFamily(event);
		const id = await itemIdOf(event);
		if (!id) {
			return fail(400, { error: m.items_error() });
		}

		try {
			const deleted = await deleteItem(family.id, event.params.listId, id);
			if (!deleted) {
				return fail(400, { error: m.items_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al borrar el item');
			return fail(400, { error: m.items_error() });
		}

		return { success: true };
	},

	// Marcar/desmarcar comprado (checklist #69): el toggle del checkbox. Sin
	// schema de superforms (el id oculto y el booleano del checkbox); el valor
	// NUEVO viaja en el formulario — el checkbox lleva value «true» sobre un
	// hidden «false», así que «true» solo aparece si venía marcado — y el
	// servidor lo fija tal cual, sin leer-then-write. El cliente aplica el
	// cambio de forma optimista y revierte si la acción falla.
	purchased: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const id = data.get('item');
		if (typeof id !== 'string' || !id) {
			return fail(400, { error: m.items_error() });
		}
		const purchased = data.getAll('purchased').includes('true');

		try {
			const ok = await setItemPurchased(family.id, event.params.listId, id, purchased);
			if (!ok) {
				return fail(400, { error: m.items_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al marcar el item');
			return fail(400, { error: m.items_error() });
		}

		return { success: true };
	}
};
