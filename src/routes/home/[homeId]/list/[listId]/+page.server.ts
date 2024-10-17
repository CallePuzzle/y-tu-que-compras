import { error } from '@sveltejs/kit';
import { initializePrisma } from '$lib/server/db';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { ListSchema, ListSchemaWithId } from '$lib/schemas';
import { add, edit } from '$lib/components/list-of';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { List } from '@prisma/client';
import { logger } from '$lib/server/logger';

export const actions: Actions = {};

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {
	const homeId = event.params.homeId;
	const listId = event.params.listId;
	const db = event.platform!.env.DB;
	const prisma = initializePrisma(db);
	const list = await prisma.list.findUnique({
		where: {
			id: parseInt(listId),
			homeId: parseInt(homeId)
		},
		include: {
			groceries: {
				include: {
					grocery: true
				}
			}
		}
	});
	logger.debug(list, 'list');
	if (!list) {
		error(404, {
			message: 'Not found'
		});
	}
	return { list };
};
