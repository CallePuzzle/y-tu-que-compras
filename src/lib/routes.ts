import type { RouteId } from '$app/types';
import type { RouteMap } from '@callepuzzle/core';
import History from '@lucide/svelte/icons/history';
import ListChecks from '@lucide/svelte/icons/list-checks';
import LogIn from '@lucide/svelte/icons/log-in';
import Refrigerator from '@lucide/svelte/icons/refrigerator';
import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
import Store from '@lucide/svelte/icons/store';
import Tags from '@lucide/svelte/icons/tags';
import Users from '@lucide/svelte/icons/users';
import { m } from '#lib/paraglide/messages.js';

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
		// La gestión de categorías de la familia (#170): en el menú de escritorio
		// y en el cajón lateral, pero FUERA del dock móvil (#162): la barra
		// inferior se queda con la navegación de ida y vuelta y la gestión fina
		// de categorías no es navegación de uso diario (como el historial).
		routes['/categories'] = {
			label: m.routes_categories(),
			icon: Tags,
			showInMenu: true,
			showInMobile: false
		};
		// La gestión de establecimientos de la familia (#183): como las
		// categorías, en el menú de escritorio y en el cajón lateral pero FUERA
		// del dock móvil — la barra inferior se queda con la navegación de ida
		// y vuelta y la gestión fina no es navegación de uso diario.
		routes['/stores'] = {
			label: m.routes_stores(),
			icon: Store,
			showInMenu: true,
			showInMobile: false
		};
		// El historial de compras de la familia activa (#76): el archivo de lo
		// ya comprado, con el detalle de cada ticket. Fuera del dock móvil
		// (#162): la barra inferior se queda con la navegación de ida y vuelta
		// (inicio, listas, despensa y familias) y el historial, que es archivo
		// de consulta, queda a un toque en el cajón lateral y en el menú de
		// escritorio (`showInMenu` se mantiene).
		routes['/history'] = {
			label: m.routes_history(),
			icon: History,
			showInMenu: true,
			showInMobile: false
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
