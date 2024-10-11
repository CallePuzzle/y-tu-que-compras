import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { HomeSchema } from '$lib/schemas';
import { logger } from '$lib/server/logger';
import { fail } from '@sveltejs/kit';
import { initializePrisma } from '$lib/server/db';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { Home } from '@prisma/client';

export const actions: Actions = {
	addHome: async (event) => {
		const form = await superValidate(event.request, zod(HomeSchema));
		logger.info(form, 'addHome form');
		if (!form.valid) {
			logger.debug('form invalid');
			return fail(400, { form });
		}

		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		try {
			let home = await prisma.home.create({
				data: {
					...form.data,
					members: {
						connect: {
							id: event.locals.user!.id
						}
					}
				}
			});
			logger.info(home, 'home created');
			return message(form, 'Form posted successfully!');
		} catch (error) {
			logger.error(error);
			return message(form, 'Error updating profile');
		}
	}
};

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {
	const form = await superValidate(zod(HomeSchema));

	let houses: Home[] = [];

	if (event.locals.user) {
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		houses = await prisma.home.findMany({
			where: {
				members: {
					some: {
						id: event.locals.user.id
					}
				}
			}
		});
		if (!houses) houses = [];
	}

	return { form: form, houses: houses };
};
