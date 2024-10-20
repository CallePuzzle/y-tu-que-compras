import { logger } from '$lib/server/logger';
import { json, error } from '@sveltejs/kit';
import { initializePrisma } from '$lib/server/db';

import type { RequestEvent } from '@sveltejs/kit';

export async function GET(event: RequestEvent): Promise<Response> {
	const groceryListId = event.url.searchParams.get('id');
	const groceryListCompleted = event.url.searchParams.get('completed');

	logger.debug({ groceryListId, groceryListCompleted }, 'toggleCheck');

	const db = event.platform!.env.DB;
	const prisma = initializePrisma(db);

	const completed = groceryListCompleted !== 'true';

	try {
		const groceryList = await prisma.groceryList.update({
			where: {
				id: parseInt(groceryListId as string)
			},
			data: {
				completed: completed
			},
			include: {
				grocery: true
			}
		});
		logger.info('groceryList with id ' + groceryListId + ' updated');
		return json({ groceryList });
	} catch (e) {
		logger.error(e);
		error(500, e.message);
	}
}
