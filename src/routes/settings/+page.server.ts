import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// «Ajustes» no tiene vista propia (todavía): hoy su única sección es la
// gestión de tokens de API (épica #260, tarea #273). El redirect mantiene la
// URL canónica en la barra y deja el hueco hecho para las secciones futuras,
// sin mover la entrada del menú (que apunta aquí).
export const load: PageServerLoad = async () => {
	redirect(302, '/settings/api-tokens');
};
