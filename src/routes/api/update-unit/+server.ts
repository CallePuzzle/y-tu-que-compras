import { logger } from '$lib/server/logger';
import { json, error } from '@sveltejs/kit';
import { initializePrisma } from '$lib/server/db';

import type { RequestEvent } from '@sveltejs/kit';

export async function GET(event: RequestEvent): Promise<Response> {
	const groceryListId = event.url.searchParams.get('id');
	const unit = event.url.searchParams.get('unit');

	logger.debug({ groceryListId, unit }, 'updateUnit');

	const db = event.platform!.env.DB;
	const prisma = initializePrisma(db);

	try {
		const groceryList = await prisma.groceryList.update({
			where: {
				id: parseInt(groceryListId as string)
			},
			data: {
				unit: unit as string
			},
			include: {
				grocery: true
			}
		});
		logger.info('groceryList with id ' + groceryListId + ' updated');
		return json({ groceryList });
	} catch (e) {
		logger.error(e);
		error(500, (e as Error).message);
	}
}
