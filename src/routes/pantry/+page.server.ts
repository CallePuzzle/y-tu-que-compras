import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { m } from '#lib/paraglide/messages.js';
import { readdSchema } from '#lib/schemas/pantry.js';
import { listCategories } from '#lib/server/categories.js';
import { requireActiveFamily } from '#lib/server/family-context.js';
import { listLists } from '#lib/server/lists.js';
import {
	adjustPantryItem,
	listPantryItems,
	removePantryItem,
	readdPantryItem,
	setPantryItemCategory
} from '#lib/server/pantry.js';
import logger from '#lib/server/logger.js';
import type { Actions, PageServerLoad } from './$types';

// La despensa de la familia activa (issues #44, #72, #73 y #74): la consulta
// trae los productos, la acción `adjust` consume/devuelve un paso por item y
// la acción `readd` lo manda a la lista de la compra elegida. La familia
// activa es la puerta de la vista (issue #63): `requireActiveFamily` manda a
// `/families` a quien no tiene o no ha elegido, y su id — ya verificado contra
// la membresía — es el que filtra la query. Con las categorías (#176), el
// load trae también las de la familia y la acción `recategorize` cambia la de
// un producto: escritura para cualquier miembro (issue #111), sin checks de
// rol — igual que consumir o re-añadir.

// Los schemas se construyen EN REQUEST, nunca en scope de módulo (regla i18n
// de la librería): los textos de Paraglide se resuelven con la locale de la
// petición.
function readdFormSchema() {
	return readdSchema({
		listIdError: m.schema_readd_list_error(),
		listIdLabel: m.schema_readd_list_label(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.pantry_readd_quantity_label()
	});
}

// El modal de re-añadir lleva SU formulario de superforms, con id propio para
// que el resultado de su acción no pise al `adjust`.
const READD_FORM_ID = 'readd-item';

/** Valores iniciales del formulario: los reales los fija `abrirReAnadir` con el producto pulsado. */
const EMPTY_READD = { listId: '', quantity: 1 } as const;

export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);
	return {
		items: await listPantryItems(family.id),
		// Las categorías de la familia (#176): dan a la vista sus secciones (en
		// su orden: posición, y por creación para desempatar) y al modal de
		// recategorización sus opciones.
		categories: await listCategories(family.id),
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

	// Quitar un producto de la despensa del todo (issue #148): la opción del
	// agotado que no va a volver a comprar. Sin schema de superforms — solo el
	// id oculto que manda el ConfirmModal, como el borrado de items de una
	// lista. El ConfirmModal ya pide confirmación: aquí solo queda el fallo.
	remove: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const id = data.get('item');
		if (typeof id !== 'string' || !id) {
			return fail(400, { error: m.pantry_error() });
		}

		try {
			const borrado = await removePantryItem(family.id, id);
			if (!borrado) {
				return fail(404, { error: m.pantry_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al quitar el producto de la despensa');
			return fail(500, { error: m.pantry_error() });
		}

		return { success: true };
	},

	// Recategorizar un producto desde la despensa (#176): el modal manda el id
	// oculto del producto y la categoría elegida ('' = «Sin categoría»). Sin
	// schema de superforms — como el ajuste, solo ids — y escritura para
	// cualquier miembro (issue #111): la categoría es un agrupado de la
	// familia, no una decisión de gestión. La categoría se valida DENTRO de la
	// transacción de `setPantryItemCategory`: una borrada mientras el modal
	// estaba abierto (o un id ajeno) es «ya no existe», 404, no un silencioso
	// «sin categoría».
	recategorize: async (event) => {
		const family = requireActiveFamily(event);
		const data = await event.request.formData();
		const id = data.get('item');
		if (typeof id !== 'string' || !id) {
			return fail(400, { error: m.pantry_error() });
		}

		// La opción «Sin categoría» llega como cadena vacía (o ausente): quita
		// la categoría del producto. Cualquier otro valor lo valida el servidor
		// contra la familia: el formulario no puede autorizar por id.
		const raw = data.get('categoryId');
		const categoryId = typeof raw === 'string' && raw ? raw : null;

		try {
			const outcome = await setPantryItemCategory(family.id, id, categoryId);
			if (outcome === 'pantry-gone') {
				return fail(404, { error: m.pantry_gone() });
			}
			if (outcome === 'category-gone') {
				return fail(404, { error: m.categories_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al cambiar la categoría del producto');
			return fail(500, { error: m.pantry_error() });
		}

		return { success: true };
	},

	// Re-añadir a la compra (checklist #74): el modal manda lista destino y
	// cantidad para la lista; la despensa queda como está (#149). El FormData
	// se lee UNA vez y alimenta al superforms y al id oculto (el body del
	// request no se puede consumir dos veces). La transacción de
	// `readdPantryItem` suma sobre el pendiente equivalente o crea el item.
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
	}
};
