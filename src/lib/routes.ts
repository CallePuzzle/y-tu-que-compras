import type { RouteId } from '$app/types';
import type { RouteMap } from '@callepuzzle/core';
import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
import { m } from '#lib/paraglide/messages.js';

// Factoría, no `const`: las etiquetas `m.*` se resuelven en render, nunca en
// scope de módulo. La clave del mapa ES la ruta; `showInMenu` pinta en el menú
// de escritorio y `showInMobile` en el dock móvil (filtros independientes).
export function getRoutes(): RouteMap<RouteId> {
	return {
		'/': {
			label: m.routes_home(),
			icon: ShoppingBasket,
			showInMenu: true,
			showInMobile: true
		}
	};
}
