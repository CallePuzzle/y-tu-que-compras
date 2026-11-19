import type { RequestHandler } from './$types';
import { readApiBody } from '#lib/server/api-body.js';
import { requireApiFamilyMember } from '#lib/server/api-family.js';
import { apiJson } from '#lib/server/api-response.js';
import { requireApiUser } from '#lib/server/api-user.js';
import { createList, listLists } from '#lib/server/lists.js';
import { listSchema } from '#lib/schemas/list.js';

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

// POST /api/v1/families/:familyId/lists (tarea #272): crea una lista en la
// familia de la URL. Body `{ name, color, icon }` validado con el mismo
// `listSchema` que el formulario web (sin textos i18n: mensajes de zod en
// inglés). Sin check de rol: escribir listas es de cualquier miembro (#111).
// 401 / 403 como el GET; 400 si el body no es JSON, 422 si no valida; 201 con
// la `ListView` recién creada (contadores a 0).
export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (!auth.ok) return auth.response;

	const { familyId } = event.params;
	const forbidden = await requireApiFamilyMember(auth.userId, familyId);
	if (forbidden) return forbidden;

	const body = await readApiBody(event.request, listSchema());
	if (!body.ok) return body.response;

	const list = await createList(familyId, body.data);
	return apiJson({ ...list, itemCount: 0, pendingCount: 0 }, 201);
};
