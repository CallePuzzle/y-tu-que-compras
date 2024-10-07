import { fail } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { initializePrisma } from '$lib/server/db';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { ListSchema, GrocerySchemaWithId } from '$lib/schemas';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { Grocery } from '@prisma/client';

export const actions: Actions = {
	addList: async (event) => {
		const form = await superValidate(event.request, zod(ListSchema));
		logger.info(form, 'addList form');
	}
};

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {};
