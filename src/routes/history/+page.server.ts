import { formatDateTime, formatPrice } from '$lib/format.js';
import { getLocale } from '$lib/paraglide/runtime.js';
import { requireActiveFamily } from '$lib/server/family-context.js';
import { listPurchases, PURCHASES_PAGE_SIZE } from '$lib/server/purchases.js';
import type { PageServerLoad } from './$types';

// El historial de compras de la familia activa (issues #47 y #76): lectura
// pura, sin acciones — el registro del historial es un snapshot inmutable
// (#75). La familia activa es la puerta de la vista (issue #63):
// `requireActiveFamily` manda a `/families` a quien no tiene o no ha elegido,
// y su id — ya verificado contra la membresía — es el que filtra la query.

/**
 * El offset del enlace «Cargar más», que viaja en la query. `null` o basura
 * (`?offset=abc`) es la primera página; el saneo fino lo hace `listPurchases`.
 */
function offsetOf(raw: string | null): number {
	if (raw === null) return 0;
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);
	const offset = offsetOf(event.url.searchParams.get('offset'));
	const { purchases, hasMore } = await listPurchases(family.id, offset);

	// La fecha y el precio se formatean EN SERVIDOR con la locale de la
	// petición (regla i18n), y viajan como texto listo para pintar: el cliente
	// no repite el `Intl`, así que ni cambia la hora al hidratar (la zona va
	// fijada en `format.ts`) ni puede desdecir el servidor.
	const locale = getLocale();

	return {
		purchases: purchases.map((compra) => ({
			id: compra.id,
			listName: compra.listName,
			date: formatDateTime(compra.createdAt, locale),
			total: formatPrice(compra.total, locale)
		})),
		hasMore,
		// El próximo «Cargar más» pide todo hasta aquí + una página más (#76).
		nextOffset: hasMore ? offset + PURCHASES_PAGE_SIZE : null
	};
};
