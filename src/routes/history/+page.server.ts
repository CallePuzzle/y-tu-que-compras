import { formatDateTime, formatPrice } from '#lib/format.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import { requireActiveFamily } from '#lib/server/family-context.js';
import {
	listPurchasesByStore,
	MAX_PURCHASES_OFFSET,
	PURCHASES_PAGE_SIZE
} from '#lib/server/purchases.js';
import type { PageServerLoad } from './$types';

// El historial de compras de la familia activa (issues #47 y #76), agrupado
// por establecimiento (#187): lectura pura, sin acciones — el registro del
// historial es un snapshot inmutable (#75). La familia activa es la puerta de
// la vista (issue #63): `requireActiveFamily` manda a `/families` a quien no
// tiene o no ha elegido, y su id — ya verificado contra la membresía — es el
// que filtra TODAS las queries.

/** El prefijo de los offsets de «Cargar más»: uno POR SECCIÓN (#187). */
const OFFSET_PREFIX = 'offset-';

/**
 * Los offsets de las secciones, leídos de la query (`?offset-<clave>=n`, con
 * la clave que trae el propio listado: id del establecimiento, su snapshot
 * con prefijo si se borró o la fija de «Sin establecimiento»). `null` o
 * basura (`?offset-x=abc`) es la primera página de ese bloque; por encima
 * del tope se ACOTA (issue #109), igual que hace `listPurchasesByStore` por
 * su cuenta, para que el offset que alimenta el siguiente «Cargar más» sea
 * coherente con la página servida. Las claves que ya no corresponden a
 * ninguna sección (el listado manda) simplemente no se usan.
 */
function offsetsOf(params: URLSearchParams): Record<string, number> {
	const offsets: Record<string, number> = {};
	for (const [name, raw] of params) {
		if (!name.startsWith(OFFSET_PREFIX)) continue;
		const key = name.slice(OFFSET_PREFIX.length);
		if (!key) continue;
		const parsed = Number(raw);
		if (!Number.isInteger(parsed) || parsed <= 0) continue;
		offsets[key] = Math.min(parsed, MAX_PURCHASES_OFFSET);
	}
	return offsets;
}

export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);
	const { groups } = await listPurchasesByStore(family.id, offsetsOf(event.url.searchParams));

	// La fecha y el precio se formatean EN SERVIDOR con la locale de la
	// petición (regla i18n), y viajan como texto listo para pintar: el cliente
	// no repite el `Intl`, así que ni cambia la hora al hidratar (la zona va
	// fijada en `format.ts`) ni puede desdecir el servidor.
	const locale = getLocale();

	return {
		groups: groups.map((group) => ({
			key: group.key,
			storeName: group.storeName,
			purchases: group.purchases.map((purchase) => ({
				id: purchase.id,
				listName: purchase.listName,
				date: formatDateTime(purchase.createdAt, locale),
				total: formatPrice(purchase.total, locale)
			})),
			// El offset servido vuelve al cliente: alimenta los inputs ocultos
			// de los «Cargar más» de las OTRAS secciones, para que cargar una
			// no reinicie las páginas de las demás (#187).
			offset: group.offset,
			hasMore: group.hasMore,
			// El próximo «Cargar más» de la sección pide todo hasta aquí + una
			// página más (#76).
			nextOffset: group.hasMore ? group.offset + PURCHASES_PAGE_SIZE : null
		}))
	};
};
