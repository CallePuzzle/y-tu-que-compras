import type { RequestHandler } from './$types';
import { apiError } from '#lib/server/api-error.js';
import { requireApiFamilyMember } from '#lib/server/api-family.js';
import { apiJson } from '#lib/server/api-response.js';
import { requireApiUser } from '#lib/server/api-user.js';
import { listItems } from '#lib/server/items.js';
import { getList } from '#lib/server/lists.js';

// GET /api/v1/families/:familyId/lists/:listId (épica #260, tarea #275): una
// lista de la familia de la URL con sus items embebidos, en el mismo orden
// visual que la UI (pendientes → comprados; dentro, `order` y antigüedad).
// 401 sin token válido, 403 sin pertenencia (o familia inexistente), 404 si
// la lista no existe o es de otra familia (no se revela cuál de las dos);
// 200 con `ListView & { items: ItemView[] }`.
export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId, listId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	const list = await getList(familyId, listId);
	if (!list) return apiError(404, 'not_found', 'List not found');

	return apiJson({ ...list, items: await listItems(familyId, listId) });
};
