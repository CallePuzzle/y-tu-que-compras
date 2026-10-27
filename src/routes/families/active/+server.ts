import { error, type RequestHandler } from '@sveltejs/kit';

import { m } from '$lib/paraglide/messages.js';
import { switchActiveFamily } from '$lib/server/family-context.js';

/**
 * Cambio de familia activa del selector (issue #64). El POST llega del
 * `FamilySwitcher` de la navegación con `familyId` en el formulario; la sesión
 * la exige `handleAuthGuard` (esta ruta no es pública) y la pertenencia la
 * verifica `switchActiveFamily` ANTES de escribir la cookie: el id que llega
 * del cliente nunca se confía.
 *
 * Con un 204 el cliente invalida los datos: todos los loads se reejecutan y
 * en cada uno `handleFamilyContext` resuelve ya el nuevo contexto desde la
 * cookie recién fijada. Ese es el «cambio de familia y todas las vistas
 * muestran los datos de la nueva activa» del criterio de aceptación.
 */
export const POST: RequestHandler = async (event) => {
	const form = await event.request.formData().catch(() => null);
	const familyId = form?.get('familyId');
	if (typeof familyId !== 'string' || familyId === '') {
		error(400, m.families_switch_error());
	}

	if (!(await switchActiveFamily(event, familyId))) {
		// Sin sesión (el guard ya habría redirigido) o sin membresía de esa
		// familia: no se ha escrito nada.
		error(403, m.families_switch_forbidden());
	}

	return new Response(null, { status: 204 });
};
