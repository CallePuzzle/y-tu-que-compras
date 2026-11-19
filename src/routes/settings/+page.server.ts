import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// «Ajustes» no tiene vista propia (todavía): hoy su única sección es la
// gestión de tokens de API (épica #260, tarea #273), a la que ya apunta el
// menú. Este redirect solo cubre a quien teclea /settings a mano.
export const load: PageServerLoad = async () => {
	redirect(302, '/settings/api-tokens');
};
