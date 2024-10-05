import { logger } from '$lib/server/logger';
import { initializePrisma } from '$lib/server/db';
import { error } from '@sveltejs/kit';
import { t } from '$lib/translations';

import type { PageServerLoad, PageServerLoadEvent } from './$types';

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {
	if (!event.locals.user) {
		return error(404, t.get('home.notFound'));
	}
	const db = event.platform!.env.DB;
	const prisma = initializePrisma(db);
	const homeId = (event.params as { slug: string }).slug;
	const home = await prisma.home.findUnique({
		where: {
			id: parseInt(homeId),
			members: {
				some: {
					id: event.locals.user!.id
				}
			}
		}
	});
	logger.debug(home, 'gang');
	if (!home) {
		return error(404, t.get('home.notFound'));
	}

	return {
		home: home
	};
};
