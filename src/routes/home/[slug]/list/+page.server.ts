import { fail } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { initializePrisma } from '$lib/server/db';
import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { ListSchema } from '$lib/schemas';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { List, Grocery } from '@prisma/client';

export const actions: Actions = {
	addList: async (event) => {
		const form = await superValidate(event, zod(ListSchema));
		logger.info(form.data, 'addList form');
		if (!form.valid) {
			logger.debug('form invalid');
			return fail(400, { form });
		}
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		const homeId = event.params.slug;
		try {
			const listData = {
				name: form.data.name,
				homeId: parseInt(homeId)
			};
			const list = await prisma.list.create({
				data: {
					...listData,
					groceries: {
						create: form.data.groceries.map((grocery) => ({
							grocery: {
								connect: {
									id: grocery
								}
							}
						}))
					}
				}
			});
			logger.info(list, 'grocery created');
			return message(form, 'Form posted successfully!');
		} catch (error) {
			logger.error(error);
			return message(form, 'Error updating profile');
		}
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
		},
		include: {
			groceries: {
				include: {
					grocery: true
				}
			}
		}
	});
	logger.info(lists, 'lists');
	_groceries = await prisma.grocery.findMany({
		where: {
			homeId: parseInt(homeId)
		}
	});
	// convert groceries to array of value label where value is id and label is name
	const groceries = _groceries.map((grocery) => {
		return {
			value: grocery.id,
			label: grocery.name,
			filterValue: grocery.name
		};
	});

	return { lists, groceries };
};
