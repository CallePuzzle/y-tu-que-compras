import type { RequestHandler } from './$types';
import { readApiBody } from '#lib/server/api-body.js';
import { apiError } from '#lib/server/api-error.js';
import { requireApiFamilyMember } from '#lib/server/api-family.js';
import { apiListPatchSchema } from '#lib/server/api-lists.js';
import { apiJson } from '#lib/server/api-response.js';
import { requireApiUser } from '#lib/server/api-user.js';
import { listApiItems } from '#lib/server/items.js';
import { deleteList, getList, updateList } from '#lib/server/lists.js';
import type { ListData } from '#lib/schemas/list.js';

/** 404 común: la lista no existe o es de otra familia (no se revela cuál). */
function listNotFound(): Response {
	return apiError('not_found', 'List not found');
}

// GET /api/v1/families/:familyId/lists/:listId (épica #260, tarea #275): una
// lista de la familia de la URL con sus items embebidos, en el mismo orden
// visual que la UI (pendientes → comprados; dentro, `order` y antigüedad).
// 401 sin token válido, 403 sin pertenencia (o familia inexistente), 404 si
// la lista no existe o es de otra familia (no se revela cuál de las dos);
// 200 con `ListView & { items: ApiItemView[] }`.
export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId, listId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	const list = await getList(familyId, listId);
	if (!list) return listNotFound();

	return apiJson({ ...list, items: await listApiItems(familyId, listId) });
};

// PATCH /api/v1/families/:familyId/lists/:listId (tarea #272): actualiza
// nombre, color y/o icono (body: `apiListPatchSchema`). Los campos ausentes
// conservan su valor: se mezclan con la lista actual y se escriben con
// `updateList`, que filtra por familia en el propio `where`. Sin check de rol
// (#111). 401 / 403 / 404 como el GET; 400 si el body no es JSON, 422 si no
// valida; 200 con la `ListView` actualizada.
export const PATCH: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId, listId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	const current = await getList(familyId, listId);
	if (!current) return listNotFound();

	const body = await readApiBody(event.request, apiListPatchSchema());
	if (!body.ok) return body.response;

	// Lo guardado ya pasó por `listSchema` al escribirse: los casts solo
	// devuelven a los enums el `string` con el que `ListView` expone color e icono.
	const patch = body.data;
	const data: ListData = {
		name: patch.name ?? current.name,
		color: patch.color ?? (current.color as ListData['color']),
		icon: patch.icon ?? (current.icon as ListData['icon'])
	};
	// `false` si la lista desapareció (o cambió de familia) entre la lectura y
	// la escritura: el mismo 404.
	if (!(await updateList(familyId, listId, data))) {
		return listNotFound();
	}

	const updated = await getList(familyId, listId);
	if (!updated) return listNotFound();
	return apiJson(updated);
};

// DELETE /api/v1/families/:familyId/lists/:listId (tarea #272): borra la lista
// y, en cascada por la FK, sus items. Sin check de rol (#111). 401 / 403 / 404
// como el GET (un segundo DELETE de la misma lista es 404); 204 sin body.
export const DELETE: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId, listId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	if (!(await deleteList(familyId, listId))) return listNotFound();

	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
