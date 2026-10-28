import type { RouteId } from '$app/types';
import type { RouteMap } from '@callepuzzle/core';
import ListChecks from '@lucide/svelte/icons/list-checks';
import LogIn from '@lucide/svelte/icons/log-in';
import Refrigerator from '@lucide/svelte/icons/refrigerator';
import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
import Users from '@lucide/svelte/icons/users';
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

	// «Listas» y «Familias» exigen sesión (el guard manda al login igualmente):
	// los enlaces sólo tienen sentido con ella, al revés que «Acceder».
	if (isLoggedIn) {
		// El núcleo de la app (#31): las listas de la familia activa.
		routes['/lists'] = {
			label: m.routes_lists(),
			icon: ListChecks,
			showInMenu: true,
			showInMobile: true
		};
		// La despensa de la familia activa (#72): se llena al finalizar compras.
		routes['/pantry'] = {
			label: m.routes_pantry(),
			icon: Refrigerator,
			showInMenu: true,
			showInMobile: true
		};
		routes['/families'] = {
			label: m.routes_families(),
			icon: Users,
			showInMenu: true,
			showInMobile: true
		};
	}

	return routes;
}
