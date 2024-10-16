import { initializePrisma } from '$lib/server/db';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { ListSchema, ListSchemaWithId } from '$lib/schemas';
import { add, edit } from '$lib/components/list-of';

import type { PageServerLoad, PageServerLoadEvent, Actions } from './$types';
import type { List } from '@prisma/client';

export const actions: Actions = {
	addList: async (event) => {
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		const prismaObject = prisma.list;
		return await add(event.request, prismaObject, ListSchema, 'List', parseInt(event.params.slug));
	},
	editList: async (event) => {
		const db = event.platform!.env.DB;
		const prisma = initializePrisma(db);
		const prismaObject = prisma.list;
		return await edit(
			event.request,
			prismaObject,
			ListSchemaWithId,
			'List',
			parseInt(event.params.slug)
		);
	}
};

export const load: PageServerLoad = async (event: PageServerLoadEvent) => {
	let lists: List[] = [];

	const homeId = event.params.slug;

	const db = event.platform!.env.DB;
	const prisma = initializePrisma(db);
	lists = await prisma.list.findMany({
		where: {
			homeId: parseInt(homeId)
		}
	});

	const forms = await Promise.all(
		lists.map(async (list) => {
			const formData = {
				id: list.id,
				name: list.name ?? undefined
			};
			return await superValidate(formData, zod(ListSchemaWithId));
		})
	);

	return { lists, forms };
};
