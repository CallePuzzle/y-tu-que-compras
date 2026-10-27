import { fail } from '@sveltejs/kit';
import { m } from '$lib/paraglide/messages.js';
import { requireActiveFamily } from '$lib/server/family-context.js';
import { adjustPantryItem, listPantryItems } from '$lib/server/pantry.js';
import logger from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

// La despensa de la familia activa (issues #44 y #72): la consulta trae los
// productos y la acción `adjust` consume/devuelve un paso por item (#73) —
// re-añadir a la compra (#74) llegará con su propia tarea. La familia activa
// es la puerta de la vista (issue #63): `requireActiveFamily` manda a
// `/families` a quien no tiene o no ha elegido, y su id — ya verificado contra
// la membresía — es el que filtra la query.
export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);
	return {
		items: await listPantryItems(family.id)
	};
};

/**
 * Consume o devuelve un paso de un producto (checklist #73). Sin schema de
 * superforms — solo el id oculto y el signo del botón pulsado, como el toggle
 * de comprado en la lista: la CANTIDAD la fija el servidor con el paso de la
 * unidad guardada, y el cliente aplica el cambio de forma optimista
 * revirtiéndolo si la acción falla.
 */
export const actions: Actions = {
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
				return fail(400, { error: m.pantry_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al ajustar la despensa');
			return fail(400, { error: m.pantry_error() });
		}

		return { success: true };
	}
};
