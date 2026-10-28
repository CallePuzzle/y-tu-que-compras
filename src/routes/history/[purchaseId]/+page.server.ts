import { redirect } from '@sveltejs/kit';
import { formatDateTime, formatPrice } from '$lib/format.js';
import { getLocale } from '$lib/paraglide/runtime.js';
import { requireActiveFamily } from '$lib/server/family-context.js';
import { getPurchase } from '$lib/server/purchases.js';
import type { PageServerLoad } from './$types';

// El detalle de una compra del historial (issues #47 y #76): el snapshot tal
// y como se cerró la compra (#75) — items con nombre, cantidad y unidad del
// momento, y el total introducido a mano. La familia activa filtra: la compra
// de otra familia es como si no existiera, como en `/lists/[listId]`.

export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);

	// Compra inexistente o ajena (enlace rancio, id inventado): de vuelta al
	// listado, igual que una lista ajena manda a `/lists`.
	const purchase = await getPurchase(family.id, event.params.purchaseId);
	if (!purchase) {
		redirect(302, '/history');
	}

	// Fecha y precio formateados EN SERVIDOR con la locale de la petición
	// (regla i18n), como en el listado: el cliente solo pinta el texto.
	const locale = getLocale();

	return {
		purchase: {
			listName: purchase.listName,
			date: formatDateTime(purchase.createdAt, locale),
			total: formatPrice(purchase.total, locale),
			items: purchase.items.map((item) => ({
				id: item.id,
				name: item.name,
				quantity: item.quantity,
				unit: item.unit
			}))
		}
	};
};
