import { fail } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { initializePrisma } from '$lib/server/db';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { GrocerySchema } from '$lib/schemas';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { Grocery } from '@prisma/client';

export const actions: Actions = {
	addGrocery: async (event) => {
		const form = await superValidate(event.request, zod(GrocerySchema));
		logger.info(form, 'addGrocery form');
		if (!form.valid) {
			logger.debug('form invalid');
			return fail(400, { form });
		}

		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		const homeId = event.params.slug;
		try {
			let grocery = await prisma.grocery.create({
				data: {
					...form.data,
					homeId: parseInt(homeId)
				}
			});
			logger.info(grocery, 'grocery created');
			return form;
		} catch (error) {
			logger.error(error);
			return form;
		}
	}
};

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {
	let groceries: Grocery[] = [];

	const homeId = event.params.slug;

	const db = event.platform!.env.DB;
	const prisma = initializePrisma(db);
	groceries = await prisma.grocery.findMany({
		where: {
			homeId: parseInt(homeId)
		}
	});

	// Por cada grocery genera un form usando superValidate
	const forms = await Promise.all(
		groceries.map(async (grocery) => {
			const groceryData = {
				name: grocery.name ?? undefined,
				description: grocery.description ?? undefined
			};
			return await superValidate(groceryData, zod(GrocerySchema));
		})
	);
	logger.debug(forms, 'forms');

	return { groceries, forms };
};
