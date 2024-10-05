import { error } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { initializePrisma } from '$lib/server/db';
import { GetDetail as UserGetDetail } from '$lib/user/get-detail';
import { superValidate, message } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { userSchema } from '$lib/schemas/user';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { Grocery } from '@prisma/client';

export const actions: Actions = {
	default: async (event) => {}
};

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {
	let groceries: Grocery[] = [];

	const db = event.platform!.env.DB;
	const prisma = initializePrisma(db);
	groceries = await prisma.grocery.findMany({
		where: {
			homeId: 1
		}
	});

	return { groceries };
};
