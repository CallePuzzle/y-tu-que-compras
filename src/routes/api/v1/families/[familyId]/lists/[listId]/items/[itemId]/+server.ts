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
import {
	deleteItem,
	getItem,
	setItemOrder,
	setItemPurchased,
	updateItem
} from '#lib/server/items.js';

/**
 * 404 común: el item no existe, es de otra lista o la lista es de otra
 * familia (no se revela cuál).
 */
function itemNotFound(): Response {
	return apiError(404, 'not_found', 'Item not found');
}

// PATCH /api/v1/families/:familyId/lists/:listId/items/:itemId (épica #260,
// tarea #268): actualización parcial de un item. Cada grupo de campos va por
// la MISMA función de dominio que la UI:
//
// - nombre/cantidad/unidad/categoría → `updateItem`, con los campos ausentes
//   mezclados con lo guardado (la categoría ausente se conserva; `null` o `''`
//   la quita; ver `api-items.ts` para id vs nombre).
// - `purchased` → `setItemPurchased`, el toggle de comprado: el valor NUEVO
//   viaja explícito, sin leer-then-write.
// - `order` → `setItemOrder`, la posición en la lista.
//
// Todas filtran por item + lista + familia en su propio `where`: si el item
// desaparece entre la lectura y la escritura, el mismo 404. Sin check de rol
// (#111). 401 / 403 / 404 como el resto de /api/v1; 400 si el body no es JSON,
// 422 si no valida; 200 con el `ApiItemView` actualizado.
export const PATCH: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId, listId, itemId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	const current = await getItem(familyId, listId, itemId);
	if (!current) return itemNotFound();

	const body = await readApiBody(event.request, apiItemPatchSchema());
	if (!body.ok) return body.response;
	const patch = body.data;

	const touchesFields =
		patch.name !== undefined ||
		patch.quantity !== undefined ||
		patch.unit !== undefined ||
		mentionsCategory(patch);
	if (touchesFields) {
		const categoryId = mentionsCategory(patch)
			? await resolveApiCategoryId(familyId, patch)
			: (current.categoryId ?? undefined);
		const updated = await updateItem(familyId, listId, itemId, {
			name: patch.name ?? current.name,
			quantity: patch.quantity ?? current.quantity,
			unit: patch.unit ?? current.unit,
			categoryId
		});
		if (!updated) return itemNotFound();
	}
	if (patch.purchased !== undefined) {
		if (!(await setItemPurchased(familyId, listId, itemId, patch.purchased))) {
			return itemNotFound();
		}
	}
	if (patch.order !== undefined) {
		if (!(await setItemOrder(familyId, listId, itemId, patch.order))) {
			return itemNotFound();
		}
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
