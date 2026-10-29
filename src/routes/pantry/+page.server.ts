import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { m } from '$lib/paraglide/messages.js';
import { readdSchema } from '$lib/schemas/pantry.js';
import { requireActiveFamily } from '$lib/server/family-context.js';
import { listLists } from '$lib/server/lists.js';
import {
	adjustPantryItem,
	listPantryItems,
	readdPantryItem,
	reorderPantryItems
} from '$lib/server/pantry.js';
import logger from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

// La despensa de la familia activa (issues #44, #72, #73 y #74): la consulta
// trae los productos, la acción `adjust` consume/devuelve un paso por item y
// la acción `readd` lo manda a la lista de la compra elegida. La familia
// activa es la puerta de la vista (issue #63): `requireActiveFamily` manda a
// `/families` a quien no tiene o no ha elegido, y su id — ya verificado contra
// la membresía — es el que filtra la query.

// Los schemas se construyen EN REQUEST, nunca en scope de módulo (regla i18n
// de la librería): los textos de Paraglide se resuelven con la locale de la
// petición.
function readdFormSchema() {
	return readdSchema({
		listIdError: m.schema_readd_list_error(),
		listIdLabel: m.schema_readd_list_label(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.pantry_readd_quantity_label(),
		pantryModeError: m.schema_readd_mode_error(),
		pantryModeLabel: m.pantry_readd_pantry_label(),
		newQuantityError: m.schema_readd_new_quantity_error(),
		newQuantityLabel: m.schema_readd_new_quantity_label()
	});
}

// El modal de re-añadir lleva SU formulario de superforms, con id propio para
// que el resultado de su acción no pise al `adjust`.
const READD_FORM_ID = 'readd-item';

/** Valores iniciales del formulario: los reales los fija `abrirReAnadir` con el producto pulsado. */
const EMPTY_READD = { listId: '', quantity: 1, pantryMode: 'keep' } as const;

export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);
	return {
		items: await listPantryItems(family.id),
		// Las listas de la familia alimentan el selector de destino del modal
		// (#74): la lista puede ser cualquiera de las de la familia.
		lists: await listLists(family.id),
		readdForm: await superValidate(EMPTY_READD, zod4(readdFormSchema()), { id: READD_FORM_ID })
	};
};

/**
 * El id del producto de despensa que viaja en el formulario (input hidden del
 * modal de re-añadir). `null` si falta: UI rancia o petición hecha a mano.
 * Recibe el FormData YA LEÍDO: `request.formData()` solo se puede consumir
 * una vez y la acción llama también a `superValidate` con él.
 */
function pantryIdOf(data: FormData): string | null {
	const id = data.get('pantry');
	return typeof id === 'string' && id ? id : null;
}

export const actions: Actions = {
	// Consumir o devolver un paso de un producto (checklist #73). Sin schema de
	// superforms — solo el id oculto y el signo del botón pulsado, como el
	// toggle de comprado en la lista: la CANTIDAD la fija el servidor con el
	// paso de la unidad guardada, y el cliente aplica el cambio de forma
	// optimista revirtiéndolo si la acción falla.
	adjust: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const id = data.get('item');
		if (typeof id !== 'string' || !id) {
			return fail(400, { error: m.pantry_error() });
		}

		// El signo solo puede ser el de los dos botones del stepper; cualquier
		// otra cosa es UI rancia o una petición hecha a mano.
		const rawDelta = data.get('delta');
		const direction = rawDelta === '1' ? 1 : rawDelta === '-1' ? -1 : null;
		if (direction === null) {
			return fail(400, { error: m.pantry_error() });
		}

		try {
			const ok = await adjustPantryItem(family.id, id, direction);
			if (!ok) {
				return fail(404, { error: m.pantry_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al ajustar la despensa');
			return fail(500, { error: m.pantry_error() });
		}

		return { success: true };
	},

	// Re-añadir a la compra (checklist #74): el modal manda lista destino,
	// cantidad para la lista y qué hacer con la despensa. El FormData se lee
	// UNA vez y alimenta al superforms y al id oculto (el body del request no
	// se puede consumir dos veces). La transacción de `readdPantryItem` suma
	// sobre el pendiente equivalente o crea el item, y ajusta la despensa.
	readd: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const form = await superValidate(data, zod4(readdFormSchema()), { id: READD_FORM_ID });
		if (!form.valid) {
			return fail(400, { readdForm: form });
		}

		const pantryId = pantryIdOf(data);
		if (!pantryId) {
			return message(form, m.pantry_gone(), { status: 400 });
		}

		try {
			const outcome = await readdPantryItem(family.id, pantryId, form.data);
			if (outcome === 'pantry-gone') {
				// Producto o lista ya no existen: 404 (issue #110).
				return message(form, m.pantry_gone(), { status: 404 });
			}
			if (outcome === 'list-gone') {
				return message(form, m.lists_gone(), { status: 404 });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al re-añadir el producto a la lista');
			return message(form, m.pantry_readd_error(), { status: 500 });
		}

		return message(form, m.pantry_readd_success());
	},

	// Reordenar una sección de la despensa (#134, drag-to-swap con Swapy):
	// «en casa» y «agotados» envían cada una SU orden nuevo (ids repetidos en
	// el FormData). Sin schema de superforms (solo ids), como el `adjust`; la
	// pertenencia y la renumeración 1..n las aplica `reorderPantryItems` en
	// su transacción — la otra sección conserva su orden relativo — y el
	// cliente revierte su optimismo si el envío falla.
	reorder: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const ids = data
			.getAll('ids')
			.filter((id): id is string => typeof id === 'string' && id !== '');

		// Payload vacío o con repetidos: UI rancia o petición hecha a mano.
		if (ids.length === 0 || new Set(ids).size !== ids.length) {
			return fail(400, { error: m.pantry_error() });
		}

		try {
			const ok = await reorderPantryItems(family.id, ids);
			if (!ok) {
				// Algún producto ya no está en esta despensa: 404 (issue #110).
				return fail(404, { error: m.pantry_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al reordenar la despensa');
			return fail(500, { error: m.pantry_error() });
		}

		return { success: true };
	}
};
