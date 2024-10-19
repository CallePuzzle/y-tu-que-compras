import { error } from '@sveltejs/kit';
import { initializePrisma } from '$lib/server/db';
import { message, superValidate, type SuperValidated } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import { ListSchema, ListSchemaWithId } from '$lib/schemas';
import { add, edit } from '$lib/components/list-of';
import { IdSchema, CompletedSchemaWithId } from '$lib/schemas';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { Grocery } from '@prisma/client';
import { logger } from '$lib/server/logger';
import type { ComboxObject } from '$lib/components/forms/partials/Combobox.svelte';
import type { GroceryListExtended } from '$lib/schemas';

export const actions: Actions = {
	addGroceryToList: async (event) => {
		const form = await superValidate(event.request, zod(IdSchema));
		logger.info(form, 'addGroceryToList');

		const homeId = event.params.homeId;
		const listId = event.params.listId;
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);

		try {
			const list = await prisma.list.update({
				where: {
					id: parseInt(listId),
					homeId: parseInt(homeId)
				},
				data: {
					groceries: {
						create: {
							grocery: {
								connect: {
									id: form.data.id
								}
							}
						}
					}
				}
			});
			logger.info('grocery with id ' + form.data.id + ' added to list with id ' + listId);
			return message(form, 'Grocery added to list successfully!');
		} catch (error) {
			logger.error(error);
			return message(form, 'Error adding grocery to list');
		}
	},
	toggleCheck: async (event) => {
		const form = await superValidate(event.request, zod(CompletedSchemaWithId));
		logger.info(form, 'toggleCheck');

		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);

		try {
			const groceryList = await prisma.groceryList.update({
				where: {
					id: form.data.id
				},
				data: {
					completed: !form.data.completed
				}
			});
			logger.info('groceryList with id ' + form.data.id + ' updated');
			return message(form, 'Grocery updated successfully!');
		} catch (error) {
			logger.error(error);
			return message(form, 'Error updating grocery');
		}
	}
};

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

	let _groceries: Grocery[] = [];
	_groceries = await prisma.grocery.findMany({
		where: {
			homeId: parseInt(homeId)
		}
	});
	const groceries = _groceries.map((grocery) => {
		return {
			value: grocery.id as unknown as string,
			label: grocery.name,
			filterValue: grocery.name
		} as ComboxObject;
	});

	const completedGroceries = list.groceries.filter(
		(grocery) => grocery.completed
	) as GroceryListExtended[];
	const todoGroceries = list.groceries.filter(
		(grocery) => !grocery.completed
	) as GroceryListExtended[];

	const completedForms = await getForm(completedGroceries);

	const todoForms = await getForm(todoGroceries);

	return { list, groceries, completedGroceries, todoGroceries, completedForms, todoForms };
};

async function getForm(
	groceryList: GroceryListExtended[]
): Promise<Record<string, SuperValidated<z.infer<typeof CompletedSchemaWithId>>>> {
	const form = await Promise.all(
		groceryList.map(async (grocery) => {
			const formData = {
				id: grocery.id,
				completed: grocery.completed
			};
			return await superValidate(formData, zod(CompletedSchemaWithId));
		})
	);
	let ret: Record<string, SuperValidated<z.infer<typeof CompletedSchemaWithId>>> = {};
	for (let list of form) {
		ret[list.data.id] = list;
	}
	return ret;
}
