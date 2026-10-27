import { requireActiveFamily } from '$lib/server/family-context.js';
import { listPantryItems } from '$lib/server/pantry.js';
import type { PageServerLoad } from './$types';

// La despensa de la familia activa (issues #44 y #72): solo lectura por
// ahora — consumir (#73) y re-añadir (#74) llegarán con sus propias tareas.
// La familia activa es la puerta de la vista (issue #63): `requireActiveFamily`
// manda a `/families` a quien no tiene o no ha elegido, y su id — ya
// verificado contra la membresía — es el que filtra la query.
export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);
	return {
		items: await listPantryItems(family.id)
	};
};
