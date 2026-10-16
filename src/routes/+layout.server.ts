import type { LayoutServerLoad } from './$types';

// Expone el usuario de la sesión a la UI (NavBarEnd, avisos de contenido). La
// PROTECCIÓN de rutas no vive aquí: un load de layout no cubre `+server.ts` ni
// form actions (de eso se encarga `handleAuthGuard` en hooks.server.ts).
export const load: LayoutServerLoad = (event) => {
	// Los loads de servidor sólo se reejecutan al navegar si dependen de
	// url/params; este no depende de nada, así que SvelteKit reutilizaría el
	// `user` viejo para siempre. `depends` declara la dependencia real (la
	// sesión); los cambios de sesión se invalidan con `invalidateAll` en el
	// login (`+page.svelte` de /login) y en el logout (`onSignOut` del layout).
	event.depends('app:session');
	return { user: event.locals.user };
};
