import { m } from './paraglide/messages.js';
import { routes as coreRoutes, type Routes } from 'storybook-svelte';

const myRoutes: Routes = {
	home_list: {
		name: m.routes_home_list(),
		url: '/home/',
		isProtected: true,
		showInMenu: true
	},
	home_index: {
		name: m.routes_home_index(),
		url: (id: string) => `/home/${id}`,
		isProtected: true,
		showInMenu: false
	},
	grocery_index: {
		name: m.routes_grocery_index(),
		url: (id: string) => `/home/${id}/grocery`,
		isProtected: true,
		showInMenu: false
	}
};

export const routes = { ...coreRoutes, ...myRoutes };
