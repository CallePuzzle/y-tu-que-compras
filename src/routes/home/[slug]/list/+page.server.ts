import { fail } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { initializePrisma } from '$lib/server/db';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { ListSchema, GrocerySchemaWithId } from '$lib/schemas';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { List, Grocery } from '@prisma/client';

export const actions: Actions = {
	addList: async (event) => {
		logger.debug(event, 'addList event');
		const form = await superValidate(event, zod(ListSchema));
		logger.info(form.data, 'addList form');
	}
};

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {
	let lists: List[] = [];
	let _groceries: Grocery[] = [];

	const homeId = event.params.slug;

	const db = event.platform!.env.DB;
	const prisma = initializePrisma(db);
	lists = await prisma.list.findMany({
		where: {
			homeId: parseInt(homeId)
		}
	});
	_groceries = await prisma.grocery.findMany({
		where: {
			homeId: parseInt(homeId)
		}
	});
	// convert groceries to array of value label where value is id and label is name
	const groceries = _groceries.map((grocery) => {
		return {
			value: grocery.id,
			label: grocery.name
		};
	});

	return { lists, groceries };
};
