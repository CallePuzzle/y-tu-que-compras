import type { RouteId } from '$app/types';
import type { RouteMap } from '@callepuzzle/core';
import LogIn from '@lucide/svelte/icons/log-in';
import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
import { m } from '$lib/paraglide/messages.js';

// Factoría, no `const`: las etiquetas `m.*` se resuelven en render, nunca en
// scope de módulo. La clave del mapa ES la ruta; `showInMenu` pinta en el menú
// de escritorio y `showInMobile` en el dock móvil (filtros independientes).
export function getRoutes(isLoggedIn: boolean): RouteMap<RouteId> {
	const routes: RouteMap<RouteId> = {
		'/': {
			label: m.routes_home(),
			icon: ShoppingBasket,
			showInMenu: true,
			showInMobile: true
		}
	};

	// «Acceder» sólo tiene sentido sin sesión: con ella la salida es el menú de
	// usuario de NavBarEnd (cerrar sesión), y el enlace al login sobraría en los
	// menús. El layout pasa `Boolean(data.user)` con `$derived` para que el mapa
	// se recalcule en cuanto la sesión aparece o desaparece.
	if (!isLoggedIn) {
		routes['/login'] = {
			label: m.routes_login(),
			icon: LogIn,
			showInMenu: true,
			showInMobile: true
		};
	}

	return routes;
}
