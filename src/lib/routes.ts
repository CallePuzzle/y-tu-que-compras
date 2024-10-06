interface Route {
	name: string;
	url?: string;
	generateUrl?: (params: any) => string;
}

interface Routes {
	[id: string]: Route;
}

const Routes: Routes = {
	home: {
		name: 'Inicio',
		url: '/'
	},
	login: {
		name: 'Login',
		url: '/login'
	},
	profile: {
		name: 'Perfil',
		url: '/profile'
	},
	notification_my: {
		name: 'Mis notificaciones',
		url: '/notification/my'
	},
	notification_subscribe: {
		name: 'Subscribe',
		url: '/notification/subscribe'
	},
	home_index: {
		name: 'Index de una casa',
		generateUrl: (params: { id: string }) => `/home/${params.id}`
	},
	grocery_index: {
		name: 'Productos / comida',
		generateUrl: (params: { id: string }) => `/home/${params.id}/grocery`
	},
	list_index: {
		name: 'Listas de la compra',
		generateUrl: (params: { id: string }) => `/home/${params.id}/list`
	},
	store_index: {
		name: 'Despensa / nevera',
		generateUrl: (params: { id: string }) => `/home/${params.id}/store`
	}
};

interface ProtectedRoute {
	path: string;
	message: string;
}

const ProtectedRoutes: ProtectedRoute[] = [
	{
		path: '/profile',
		message: 'Para ver tu perfil necesitas iniciar sesión'
	},
	{
		path: '/notification/my',
		message: 'Para ver tus notificaciones necesitas iniciar sesión'
	}
];

export { Routes, ProtectedRoutes };
