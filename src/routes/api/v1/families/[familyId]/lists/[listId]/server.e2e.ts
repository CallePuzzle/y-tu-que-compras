import { expect, test, type Page } from '@playwright/test';
import { bearer, createApiToken } from '../../../../../../../../e2e/helpers/api';
import { loginViaUi, seedSession } from '../../../../../../../../e2e/helpers/auth';
import { prisma } from '../../../../../../../../e2e/helpers/db';
import {
	addFamilyMember,
	createCategory,
	createFamily,
	createItem,
	createList,
	createUser,
	resetDb
} from '../../../../../../../../e2e/helpers/seed';

// GET /api/v1/families/:familyId/lists/:listId (US2 #262, tarea #276) contra
// el stack completo: dev server real, BD de test y tokens REALES del plugin
// apiKey. Las peticiones a la API van con el fixture `request` (sin cookies):
// la única credencial es el Bearer. El plugin limita cada clave a 10
// peticiones al día; con `resetDb` por test cada uno estrena las suyas.
//
// PATCH y DELETE (US3 #263, tarea #277) van al final: 403 sin pertenencia,
// 404 cross-family (sin tocar la lista ajena), 422 con envelope en el PATCH,
// cascada de items en el DELETE y los cambios visibles luego en el GET.

const UNAUTHORIZED = { error: { code: 'unauthorized', message: 'Missing or invalid API key' } };
const FORBIDDEN = { error: { code: 'forbidden', message: 'Not a member of this family' } };
const NOT_FOUND = { error: { code: 'not_found', message: 'List not found' } };

test.beforeEach(async () => {
	await resetDb();
});

test('sin Bearer responde 401 con el envelope de error', async ({ request }) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	const list = await createList({ familyId: family.id });

	const response = await request.get(`/api/v1/families/${family.id}/lists/${list.id}`);

	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual(UNAUTHORIZED);
});

test('token de un usuario ajeno a la familia responde 403 aunque la lista exista', async ({
	page,
	request
}) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	const list = await createList({ familyId: family.id, name: 'Privada' });

	const outsider = await createUser();
	await createFamily({ owner: outsider });
	await seedSession(page, outsider);
	const token = await createApiToken(page);

	const response = await request.get(`/api/v1/families/${family.id}/lists/${list.id}`, {
		headers: bearer(token)
	});

	expect(response.status()).toBe(403);
	expect(await response.json()).toEqual(FORBIDDEN);
});

test('una lista de otra familia responde 404 aunque el usuario sea miembro de ambas', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const other = await createFamily({ owner: await createUser() });
	await addFamilyMember({ familyId: other.id, user });
	const foreignList = await createList({ familyId: other.id, name: 'De la otra familia' });
	await seedSession(page, user);
	const token = await createApiToken(page);

	// La lista existe y el usuario puede verla por SU familia, pero no por esta
	// URL: el recurso de otra familia es «no existe» (no se revela dónde vive).
	const crossFamily = await request.get(`/api/v1/families/${family.id}/lists/${foreignList.id}`, {
		headers: bearer(token)
	});
	expect(crossFamily.status()).toBe(404);
	expect(await crossFamily.json()).toEqual(NOT_FOUND);

	// Por la URL de su familia sí sale: el 404 de arriba es por el cruce.
	const ownFamily = await request.get(`/api/v1/families/${other.id}/lists/${foreignList.id}`, {
		headers: bearer(token)
	});
	expect(ownFamily.status()).toBe(200);
	expect(await ownFamily.json()).toMatchObject({ id: foreignList.id, items: [] });
});

test('un listId inexistente responde 404', async ({ page, request }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await seedSession(page, user);
	const token = await createApiToken(page);

	const response = await request.get(`/api/v1/families/${family.id}/lists/no-existe`, {
		headers: bearer(token)
	});

	expect(response.status()).toBe(404);
	expect(await response.json()).toEqual(NOT_FOUND);
});

test('camino feliz: login OTP real, token y 200 con la ListView y sus ItemView en orden visual', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lacteos = await createCategory({ familyId: family.id, name: 'Lácteos' });
	const list = await createList({ familyId: family.id, name: 'Semanal', color: 'green' });
	// Leche comprada: va detrás de los pendientes aunque su `order` sea menor.
	const leche = await createItem({
		listId: list.id,
		name: 'Leche',
		quantity: 2,
		unit: 'liter',
		purchased: true,
		order: 0,
		categoryId: lacteos.id
	});
	const pan = await createItem({ listId: list.id, name: 'Pan', order: 1 });
	const huevos = await createItem({ listId: list.id, name: 'Huevos', unit: 'dozen', order: 2 });

	await loginViaUi(page, user.email);
	const token = await createApiToken(page);

	const response = await request.get(`/api/v1/families/${family.id}/lists/${list.id}`, {
		headers: bearer(token)
	});

	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
	expect(response.headers()['cache-control']).toBe('no-store');
	expect(await response.json()).toEqual({
		id: list.id,
		name: 'Semanal',
		color: 'green',
		icon: list.icon,
		itemCount: 3,
		pendingCount: 2,
		items: [
			{
				id: pan.id,
				name: 'Pan',
				quantity: 1,
				unit: 'unit',
				categoryId: null,
				categoryName: null,
				purchased: false
			},
			{
				id: huevos.id,
				name: 'Huevos',
				quantity: 1,
				unit: 'dozen',
				categoryId: null,
				categoryName: null,
				purchased: false
			},
			{
				id: leche.id,
				name: 'Leche',
				quantity: 2,
				unit: 'liter',
				categoryId: lacteos.id,
				categoryName: 'Lácteos',
				purchased: true
			}
		]
	});
});

// --- PATCH / DELETE /api/v1/families/:familyId/lists/:listId (US3 #263, tarea #277) ---

/** Usuario miembro de su familia y de otra con una lista con items, más su token. */
async function seedCrossFamily(page: Page) {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const other = await createFamily({ owner: await createUser() });
	await addFamilyMember({ familyId: other.id, user });
	const foreignList = await createList({
		familyId: other.id,
		name: 'De la otra familia',
		color: 'red',
		icon: 'gift'
	});
	await createItem({ listId: foreignList.id, name: 'Pan' });
	await seedSession(page, user);
	const token = await createApiToken(page);
	return { family, other, foreignList, token };
}

test('PATCH/DELETE: token de un usuario ajeno a la familia responde 403 sin tocar la lista', async ({
	page,
	request
}) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	const list = await createList({ familyId: family.id, name: 'Privada', color: 'red' });
	await createItem({ listId: list.id, name: 'Pan' });

	const outsider = await createUser();
	await createFamily({ owner: outsider });
	await seedSession(page, outsider);
	const token = await createApiToken(page);
	const url = `/api/v1/families/${family.id}/lists/${list.id}`;

	const patch = await request.patch(url, { headers: bearer(token), data: { name: 'Hackeada' } });
	expect(patch.status()).toBe(403);
	expect(await patch.json()).toEqual(FORBIDDEN);

	const del = await request.delete(url, { headers: bearer(token) });
	expect(del.status()).toBe(403);
	expect(await del.json()).toEqual(FORBIDDEN);

	const stored = await prisma.list.findUniqueOrThrow({ where: { id: list.id } });
	expect(stored.name).toBe('Privada');
	expect(await prisma.item.count({ where: { listId: list.id } })).toBe(1);
});

test('PATCH/DELETE: una lista de otra familia responde 404 y sigue intacta', async ({
	page,
	request
}) => {
	const { family, other, foreignList, token } = await seedCrossFamily(page);
	const crossUrl = `/api/v1/families/${family.id}/lists/${foreignList.id}`;

	const patch = await request.patch(crossUrl, {
		headers: bearer(token),
		data: { name: 'Renombrada' }
	});
	expect(patch.status()).toBe(404);
	expect(await patch.json()).toEqual(NOT_FOUND);

	const del = await request.delete(crossUrl, { headers: bearer(token) });
	expect(del.status()).toBe(404);
	expect(await del.json()).toEqual(NOT_FOUND);

	// Por la URL de su familia la lista sigue igual, con su item.
	const own = await request.get(`/api/v1/families/${other.id}/lists/${foreignList.id}`, {
		headers: bearer(token)
	});
	expect(own.status()).toBe(200);
	expect(await own.json()).toMatchObject({
		id: foreignList.id,
		name: 'De la otra familia',
		itemCount: 1,
		items: [{ name: 'Pan' }]
	});
});

test('PATCH: un listId inexistente responde 404 (antes que validar el body)', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await seedSession(page, user);
	const token = await createApiToken(page);
	const url = `/api/v1/families/${family.id}/lists/no-existe`;

	const patch = await request.patch(url, { headers: bearer(token), data: { color: 'fucsia' } });
	expect(patch.status()).toBe(404);
	expect(await patch.json()).toEqual(NOT_FOUND);

	const del = await request.delete(url, { headers: bearer(token) });
	expect(del.status()).toBe(404);
	expect(await del.json()).toEqual(NOT_FOUND);
});

test('PATCH: payload inválido responde 422 con el envelope y no cambia la lista', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Semanal', color: 'green' });
	await seedSession(page, user);
	const token = await createApiToken(page);
	const url = `/api/v1/families/${family.id}/lists/${list.id}`;

	const cases = [
		{ payload: { name: '' }, field: 'name' },
		{ payload: { color: 'fucsia' }, field: 'color' },
		{ payload: { icon: 'rocket' }, field: 'icon' },
		// PATCH vacío: error global del refine, sin campo.
		{ payload: {}, field: '_errors' }
	];
	for (const { payload, field } of cases) {
		const response = await request.patch(url, { headers: bearer(token), data: payload });
		expect(response.status(), field).toBe(422);
		expect(await response.json(), field).toEqual({
			error: {
				code: 'validation_failed',
				message: 'Invalid request body',
				details: { [field]: [expect.any(String)] }
			}
		});
	}

	const stored = await prisma.list.findUniqueOrThrow({ where: { id: list.id } });
	expect(stored).toMatchObject({ name: 'Semanal', color: 'green', icon: list.icon });
});

test('PATCH camino feliz: 200 con la ListView y los cambios visibles luego en el GET', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({
		familyId: family.id,
		name: 'Semanal',
		color: 'green',
		icon: 'apple'
	});
	await createItem({ listId: list.id, name: 'Pan' });
	await createItem({ listId: list.id, name: 'Leche', purchased: true });
	await loginViaUi(page, user.email);
	const token = await createApiToken(page);
	const url = `/api/v1/families/${family.id}/lists/${list.id}`;

	// Actualización parcial: el icono no viaja y se conserva.
	const response = await request.patch(url, {
		headers: bearer(token),
		data: { name: 'Mensual', color: 'blue' }
	});

	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
	expect(response.headers()['cache-control']).toBe('no-store');
	const updated = await response.json();
	expect(updated).toEqual({
		id: list.id,
		name: 'Mensual',
		color: 'blue',
		icon: 'apple',
		itemCount: 2,
		pendingCount: 1
	});

	const detail = await request.get(url, { headers: bearer(token) });
	expect(detail.status()).toBe(200);
	expect(await detail.json()).toMatchObject({ ...updated, items: expect.any(Array) });

	const collection = await request.get(`/api/v1/families/${family.id}/lists`, {
		headers: bearer(token)
	});
	expect(collection.status()).toBe(200);
	expect(await collection.json()).toEqual([updated]);
});

test('DELETE camino feliz: 204 sin body, borra los items en cascada y desaparece del GET', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'A borrar' });
	await createItem({ listId: list.id, name: 'Pan' });
	await createItem({ listId: list.id, name: 'Leche', purchased: true });
	const keep = await createList({ familyId: family.id, name: 'Se queda' });
	await createItem({ listId: keep.id, name: 'Huevos' });
	await loginViaUi(page, user.email);
	const token = await createApiToken(page);
	const url = `/api/v1/families/${family.id}/lists/${list.id}`;

	const response = await request.delete(url, { headers: bearer(token) });

	expect(response.status()).toBe(204);
	expect(response.headers()['cache-control']).toBe('no-store');
	expect(await response.text()).toBe('');

	// Cascada: los items de la lista borrada se van; los de la otra, no.
	expect(await prisma.list.findUnique({ where: { id: list.id } })).toBeNull();
	expect(await prisma.item.count({ where: { listId: list.id } })).toBe(0);
	expect(await prisma.item.count({ where: { listId: keep.id } })).toBe(1);

	// El GET de US2 ya no la ve: 404 en el detalle y fuera de la colección.
	const detail = await request.get(url, { headers: bearer(token) });
	expect(detail.status()).toBe(404);
	expect(await detail.json()).toEqual(NOT_FOUND);
	const collection = await request.get(`/api/v1/families/${family.id}/lists`, {
		headers: bearer(token)
	});
	expect(collection.status()).toBe(200);
	expect(await collection.json()).toEqual([expect.objectContaining({ id: keep.id })]);

	// Un segundo DELETE de la misma lista es 404.
	const again = await request.delete(url, { headers: bearer(token) });
	expect(again.status()).toBe(404);
	expect(await again.json()).toEqual(NOT_FOUND);
});
