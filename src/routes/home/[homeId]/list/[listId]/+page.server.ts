import { error } from '@sveltejs/kit';
import { initializePrisma } from '$lib/server/db';
import { message, superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { IdSchema } from '$lib/schemas';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { Grocery } from '@prisma/client';
import { logger } from '$lib/server/logger';
import type { InputValue } from '$lib/components/forms/Combobox.svelte';

export const actions: Actions = {
	addGroceryToList: async (event) => {
		const form = await superValidate(event.request, zod(IdSchema));
		logger.info(form, 'addGroceryToList');

		const homeId = event.params.homeId;
		const listId = event.params.listId;
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);

		try {
			await prisma.list.update({
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
		}
	});
	logger.debug(list, 'list');
	if (!list) {
		error(404, {
			message: 'Not found'
		});
	}

	const groceryList = await prisma.groceryList.findMany({
		where: {
			listId: parseInt(listId)
		},
		include: {
			grocery: true
		},
		orderBy: {
			grocery: {
				name: 'asc'
			}
		}
	});

	let _groceries: Grocery[] = [];
	_groceries = await prisma.grocery.findMany({
		where: {
			homeId: parseInt(homeId)
		}
	});
	const groceries = _groceries.map((grocery) => {
		return {
			value: grocery.id as unknown as string,
			label: grocery.name
		} as InputValue;
	});

	return { list, groceryList, groceries };
};
