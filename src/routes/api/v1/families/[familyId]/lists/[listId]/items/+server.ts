import type { RequestHandler } from './$types';
import { readApiBody } from '#lib/server/api-body.js';
import { apiError } from '#lib/server/api-error.js';
import { requireApiFamilyMember } from '#lib/server/api-family.js';
import { apiItemCreateSchema, resolveApiCategoryId } from '#lib/server/api-items.js';
import { apiJson } from '#lib/server/api-response.js';
import { requireApiUser } from '#lib/server/api-user.js';
import { createItem } from '#lib/server/items.js';

// POST /api/v1/families/:familyId/lists/:listId/items (épica #260, tarea
// #268): añade un item a una lista de la familia de la URL — el caso de uso
// central de la API. Body `{ name, quantity, unit, categoryId? | category? }`
// validado con el mismo `itemSchema` que el alta rápida de la UI (ver
// `api-items.ts`). El `order` lo calcula el SERVIDOR (`createItem`: máximo de
// la lista + 1, con la lista bloqueada), igual que en la UI. Sin check de rol:
// escribir items es de cualquier miembro (#111).
// 401 sin token válido, 403 sin pertenencia, 404 si la lista no existe o es de
// otra familia; 400 si el body no es JSON, 422 si no valida; 201 con el
// `ItemView` recién creado.
export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId, listId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	const body = await readApiBody(event.request, apiItemCreateSchema());
	if (!body.ok) return body.response;

	const { name, quantity, unit } = body.data;
	const categoryId = await resolveApiCategoryId(familyId, body.data);
	const item = await createItem(familyId, listId, { name, quantity, unit, categoryId });
	if (!item) return apiError('not_found', 'List not found');

	return apiJson(item, 201);
};
