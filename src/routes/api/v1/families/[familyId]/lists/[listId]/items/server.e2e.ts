import { expect, test } from '@playwright/test';
import { bearer, createApiToken } from '../../../../../../../../../e2e/helpers/api';
import {
	loginViaUi,
	seedSession,
	waitForHydration
} from '../../../../../../../../../e2e/helpers/auth';
import { prisma } from '../../../../../../../../../e2e/helpers/db';
import {
	addFamilyMember,
	createCategory,
	createFamily,
	createItem,
	createList,
	createUser,
	resetDb
} from '../../../../../../../../../e2e/helpers/seed';

// POST /api/v1/families/:familyId/lists/:listId/items (US4 #264, tarea #278)
// contra el stack completo: dev server real, BD de test y tokens REALES del
// plugin apiKey. Las peticiones a la API van con el fixture `request` (sin
// cookies): la única credencial es el Bearer. El plugin limita cada clave a
// 60 peticiones por minuto (#271); con `resetDb` por test cada uno estrena
// las suyas y no se acerca al límite.
//
// PATCH y DELETE del item viven en `[itemId]/server.e2e.ts`.

const UNAUTHORIZED = { error: { code: 'unauthenticated', message: 'Missing or invalid API key' } };
const FORBIDDEN = { error: { code: 'forbidden', message: 'Not a member of this family' } };
const NOT_FOUND = { error: { code: 'not_found', message: 'List not found' } };

test.beforeEach(async () => {
	await resetDb();
});

test('sin Bearer responde 401 con el envelope de error y no crea nada', async ({ request }) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	const list = await createList({ familyId: family.id });

	const response = await request.post(`/api/v1/families/${family.id}/lists/${list.id}/items`, {
		data: { name: 'Pan', quantity: 1, unit: 'unit' }
	});

	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual(UNAUTHORIZED);
	expect(await prisma.item.count({ where: { listId: list.id } })).toBe(0);
});

test('token de un usuario ajeno a la familia responde 403 y no crea nada', async ({
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

	const response = await request.post(`/api/v1/families/${family.id}/lists/${list.id}/items`, {
		headers: bearer(token),
		data: { name: 'Pan', quantity: 1, unit: 'unit' }
	});

	expect(response.status()).toBe(403);
	expect(await response.json()).toEqual(FORBIDDEN);
	expect(await prisma.item.count({ where: { listId: list.id } })).toBe(0);
});

test('una lista de otra familia (o inexistente) responde 404 y no crea nada', async ({
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
	const payload = { name: 'Pan', quantity: 1, unit: 'unit' };

	// El usuario es miembro de ambas familias, pero la lista no es de ESTA:
	// el recurso de otra familia es «no existe» (no se revela dónde vive).
	const crossFamily = await request.post(
		`/api/v1/families/${family.id}/lists/${foreignList.id}/items`,
		{ headers: bearer(token), data: payload }
	);
	expect(crossFamily.status()).toBe(404);
	expect(await crossFamily.json()).toEqual(NOT_FOUND);

	const missing = await request.post(`/api/v1/families/${family.id}/lists/no-existe/items`, {
		headers: bearer(token),
		data: payload
	});
	expect(missing.status()).toBe(404);
	expect(await missing.json()).toEqual(NOT_FOUND);

	expect(await prisma.item.count()).toBe(0);
});

test('payload inválido responde 422 con el envelope (400 si no es JSON) y no crea nada', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id });
	await seedSession(page, user);
	const token = await createApiToken(page);
	const url = `/api/v1/families/${family.id}/lists/${list.id}/items`;

	const cases = [
		{ payload: { name: 'Pan', quantity: 0, unit: 'unit' }, field: 'quantity' },
		{ payload: { name: 'Pan', quantity: -2, unit: 'unit' }, field: 'quantity' },
		{ payload: { name: 'Pan', quantity: 1, unit: 'bucket' }, field: 'unit' },
		{ payload: { name: '', quantity: 1, unit: 'unit' }, field: 'name' },
		// Categoría por id Y por nombre a la vez: ambiguo, error global del refine.
		{
			payload: { name: 'Pan', quantity: 1, unit: 'unit', categoryId: 'x', category: 'y' },
			field: '_errors'
		}
	];
	for (const { payload, field } of cases) {
		const response = await request.post(url, { headers: bearer(token), data: payload });
		expect(response.status(), field).toBe(422);
		expect(await response.json(), field).toEqual({
			error: {
				code: 'validation_failed',
				message: 'Invalid request body',
				details: { [field]: [expect.any(String)] }
			}
		});
	}

	const notJson = await request.post(url, {
		headers: { ...bearer(token), 'content-type': 'application/json' },
		data: Buffer.from('{no es json')
	});
	expect(notJson.status()).toBe(400);
	expect(await notJson.json()).toEqual({
		error: { code: 'invalid_json', message: 'Request body must be JSON' }
	});

	expect(await prisma.item.count({ where: { listId: list.id } })).toBe(0);
});

test('camino feliz: 201 con el item (order del servidor), visible en el GET y en la web', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lacteos = await createCategory({ familyId: family.id, name: 'Lácteos' });
	const list = await createList({ familyId: family.id, name: 'Semanal' });
	await createItem({ listId: list.id, name: 'Pan', order: 0 });
	await createItem({ listId: list.id, name: 'Huevos', unit: 'dozen', order: 1 });
	await loginViaUi(page, user.email);
	const token = await createApiToken(page);
	const url = `/api/v1/families/${family.id}/lists/${list.id}/items`;

	// La categoría por NOMBRE (canónico: sin acentos ni mayúsculas) y un
	// `order` en el body que el servidor ignora: la posición es suya.
	const response = await request.post(url, {
		headers: bearer(token),
		data: { name: 'Leche entera', quantity: 2, unit: 'liter', category: ' LACTEOS ', order: 99 }
	});

	expect(response.status()).toBe(201);
	expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
	expect(response.headers()['cache-control']).toBe('no-store');
	const created = await response.json();
	expect(created).toEqual({
		id: expect.any(String),
		name: 'Leche entera',
		quantity: 2,
		unit: 'liter',
		categoryId: lacteos.id,
		categoryName: 'Lácteos',
		purchased: false,
		order: 2
	});

	// Un segundo alta, sin categoría, va detrás: order 3.
	const second = await request.post(url, {
		headers: bearer(token),
		data: { name: 'Plátanos', quantity: 1.5, unit: 'kilogram' }
	});
	expect(second.status()).toBe(201);
	expect(await second.json()).toMatchObject({ order: 3, categoryId: null, categoryName: null });

	// El GET de la lista (US2) lo devuelve en su sitio.
	const detail = await request.get(`/api/v1/families/${family.id}/lists/${list.id}`, {
		headers: bearer(token)
	});
	expect(detail.status()).toBe(200);
	const listView = await detail.json();
	expect(listView).toMatchObject({ itemCount: 4, pendingCount: 4 });
	expect(listView.items.map((item: { name: string }) => item.name)).toEqual([
		'Pan',
		'Huevos',
		'Leche entera',
		'Plátanos'
	]);
	expect(listView.items[2]).toEqual(created);

	// Coherencia UI ↔ API: la web pinta el item creado por API, con su
	// cantidad, unidad y chip de categoría, al final de los pendientes.
	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });
	await expect(leche).toBeVisible();
	await expect(leche.getByText('2 L')).toBeVisible();
	await expect(leche.getByText('Lácteos')).toBeVisible();
	await expect(page.locator('ol > li')).toHaveText([/Pan/, /Huevos/, /Leche entera/, /Plátanos/]);
});
