import { m } from './paraglide/messages.js';
import { routes as coreRoutes, type Routes } from 'storybook-svelte';

const myRoutes: Routes = {
	home_index: {
		name: 'Casa',
		url: (id: string) => `/home/${id}`,
		isProtected: true,
		showInMenu: true
	},
	grocery_index: {
		name: 'Grocery',
		url: (id: string) => `/home/${id}/grocery`,
		isProtected: true,
		showInMenu: true
	}
};

export const routes = { ...coreRoutes, ...myRoutes };
