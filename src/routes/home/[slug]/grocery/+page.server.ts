import { fail } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { initializePrisma } from '$lib/server/db';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { GrocerySchema, GrocerySchemaWithId } from '$lib/schemas';

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
			const grocery = await prisma.grocery.create({
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
	},
	editGrocery: async (event) => {
		const form = await superValidate(event.request, zod(GrocerySchemaWithId));
		logger.info(form, 'editGrocery form');
		if (!form.valid) {
			logger.debug('form invalid');
			return fail(400, { form });
		}
		const { id } = form.data;
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		const homeId = event.params.slug;
		try {
			const grocery = await prisma.grocery.update({
				where: {
					id: id
				},
				data: {
					...form.data,
					homeId: parseInt(homeId)
				}
			});
			logger.info(grocery, 'grocery updated');
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

	const forms = await Promise.all(
		groceries.map(async (grocery) => {
			const groceryData = {
				id: grocery.id,
				name: grocery.name ?? undefined,
				description: grocery.description ?? undefined
			};
			return await superValidate(groceryData, zod(GrocerySchemaWithId));
		})
	);
	logger.debug(forms, 'forms');

	return { groceries, forms };
};
