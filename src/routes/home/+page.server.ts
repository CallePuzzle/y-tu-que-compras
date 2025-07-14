import db from '$lib/server/db.js';

import type { PageServerLoad, PageServerLoadEvent } from './$types';

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {
	const organizations = await db.organization.findMany();
	console.log(organizations);
};
