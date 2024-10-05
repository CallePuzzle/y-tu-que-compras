import { loadTranslations } from '$lib/translations';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ data }) => {
	await loadTranslations('es');

	return { ...data };
};
