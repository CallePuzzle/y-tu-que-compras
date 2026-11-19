import type { RequestHandler } from './$types';
import { requireApiFamilyMember } from '#lib/server/api-family.js';
import { apiJson } from '#lib/server/api-response.js';
import { requireApiUser } from '#lib/server/api-user.js';
import { listLists } from '#lib/server/lists.js';

// GET /api/v1/families/:familyId/lists (épica #260, tarea #269): las listas de
// la familia de la URL — nunca la de la cookie de familia activa — para el
// usuario del Bearer token. 401 sin token válido, 403 sin pertenencia (o
// familia inexistente); 200 con el array de `ListView`.
export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	return apiJson(await listLists(familyId));
};
