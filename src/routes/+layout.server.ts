import { listFamilyOptions } from '$lib/server/families.js';
import type { LayoutServerLoad } from './$types';

// Expone el usuario de la sesión, sus familias y la familia activa a la UI
// (NavBarEnd, FamilySwitcher, avisos de contenido). La PROTECCIÓN de rutas no
// vive aquí: un load de layout no cubre `+server.ts` ni form actions (de eso
// se encarga `handleAuthGuard` en hooks.server.ts).
export const load: LayoutServerLoad = async (event) => {
	// Los loads de servidor sólo se reejecutan al navegar si dependen de
	// url/params; este no depende de nada, así que SvelteKit reutilizaría el
	// `user` viejo para siempre. `depends` declara la dependencia real (la
	// sesión); los cambios de sesión se invalidan con `invalidateAll` en el
	// login (`+page.svelte` de /login) y en el logout (`onSignOut` del layout).
	// El cambio de familia activa también pasa por `invalidateAll`: lo lanza
	// el `FamilySwitcher` tras el POST a `/families/active`.
	event.depends('app:session');
	return {
		user: event.locals.user,
		// Familias del usuario para el selector (#64): ninguna sin sesión. La
		// activa la dejó `handleFamilyContext` en locals; `null` también cuando
		// falta por elegir (varias familias y ninguna elegida: quién decide es
		// el propio selector).
		families: event.locals.user ? await listFamilyOptions(event) : [],
		activeFamily: event.locals.activeFamily ?? null
	};
};
