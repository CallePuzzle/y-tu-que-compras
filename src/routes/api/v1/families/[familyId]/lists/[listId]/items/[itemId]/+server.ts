import type { RequestHandler } from './$types';
import { readApiBody } from '#lib/server/api-body.js';
import { apiError } from '#lib/server/api-error.js';
import { requireApiFamilyMember } from '#lib/server/api-family.js';
import {
	apiItemPatchSchema,
	mentionsCategory,
	resolveApiCategoryId
} from '#lib/server/api-items.js';
import { apiJson } from '#lib/server/api-response.js';
import { requireApiUser } from '#lib/server/api-user.js';
import { deleteItem, getItem, patchItem } from '#lib/server/items.js';

/**
 * 404 común: el item no existe, es de otra lista o la lista es de otra
 * familia (no se revela cuál).
 */
function itemNotFound(): Response {
	return apiError('not_found', 'Item not found');
}

// PATCH /api/v1/families/:familyId/lists/:listId/items/:itemId (épica #260,
// tarea #268): actualización parcial en UNA escritura (`patchItem`) con solo
// los campos presentes; la categoría ausente se conserva y `null`/`''` la
// quita (ver `api-items.ts`). Sin check de rol (#111). 404 antes que 400/422;
// 200 con el `ApiItemView` actualizado.
export const PATCH: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId, listId, itemId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	if (!(await getItem(familyId, listId, itemId))) return itemNotFound();

	const body = await readApiBody(event.request, apiItemPatchSchema());
	if (!body.ok) return body.response;
	const { name, quantity, unit, purchased, order } = body.data;

	const categoryId = mentionsCategory(body.data)
		? ((await resolveApiCategoryId(familyId, body.data)) ?? null)
		: undefined;
	const patch = { name, quantity, unit, purchased, order, categoryId };
	if (!(await patchItem(familyId, listId, itemId, patch))) {
		return itemNotFound();
	}

	const item = await getItem(familyId, listId, itemId);
	if (!item) return itemNotFound();
	return apiJson(item);
};

// DELETE /api/v1/families/:familyId/lists/:listId/items/:itemId (tarea #268):
// borra el item con `deleteItem`. Sin check de rol (#111). 401 / 403 / 404 como
// el PATCH (un segundo DELETE del mismo item es 404); 204 sin body.
export const DELETE: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId, listId, itemId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	if (!(await deleteItem(familyId, listId, itemId))) return itemNotFound();

	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
