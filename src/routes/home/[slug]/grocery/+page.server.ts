import { logger } from '$lib/server/logger';
import { initializePrisma } from '$lib/server/db';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { GrocerySchema, GrocerySchemaWithId } from '$lib/schemas';
import { add, edit } from '$lib/components/list-of';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { Grocery } from '@prisma/client';

export const actions: Actions = {
	addGrocery: async (event) => {
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		const prismaObject = prisma.grocery;
		return await add(
			event.request,
			prismaObject,
			GrocerySchema,
			'Grocery',
			parseInt(event.params.slug)
		);
	},
	editGrocery: async (event) => {
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		const prismaObject = prisma.grocery;
		return await edit(
			event.request,
			prismaObject,
			GrocerySchemaWithId,
			'Grocery',
			parseInt(event.params.slug)
		);
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
