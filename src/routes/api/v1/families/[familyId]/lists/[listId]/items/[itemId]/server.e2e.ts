import { expect, test, type Page } from '@playwright/test';
import { bearer, createApiToken } from '../../../../../../../../../../e2e/helpers/api';
import {
	loginViaUi,
	seedSession,
	waitForHydration
} from '../../../../../../../../../../e2e/helpers/auth';
import { prisma } from '../../../../../../../../../../e2e/helpers/db';
import {
	addFamilyMember,
	createCategory,
	createFamily,
	createItem,
	createList,
	createUser,
	resetDb
} from '../../../../../../../../../../e2e/helpers/seed';

// PATCH y DELETE de /api/v1/families/:familyId/lists/:listId/items/:itemId
// (US4 #264, tarea #278) contra el stack completo: dev server real, BD de
// test y tokens REALES del plugin apiKey. Las peticiones a la API van con el
// fixture `request` (sin cookies): la única credencial es el Bearer. El
// plugin limita cada clave a 60 peticiones por minuto (#271); con `resetDb`
// por test cada uno estrena las suyas y no se acerca al límite.
//
// Al final, el ciclo completo por API (crear → editar → comprar → borrar),
// con cada paso comprobado en el GET y en la web.

const UNAUTHORIZED = { error: { code: 'unauthenticated', message: 'Missing or invalid API key' } };
const FORBIDDEN = { error: { code: 'forbidden', message: 'Not a member of this family' } };
const NOT_FOUND = { error: { code: 'not_found', message: 'Item not found' } };

test.beforeEach(async () => {
	await resetDb();
});

/** URL del item en la API. */
function itemUrl(familyId: string, listId: string, itemId: string): string {
	return `/api/v1/families/${familyId}/lists/${listId}/items/${itemId}`;
}

/** Usuario dueño de una familia con una lista y un item, con sesión y token. */
async function seedOwnItem(page: Page, options: { login?: boolean } = {}) {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Semanal' });
	const item = await createItem({ listId: list.id, name: 'Leche', quantity: 2, unit: 'liter' });
	if (options.login) {
		await loginViaUi(page, user.email);
	} else {
		await seedSession(page, user);
	}
	const token = await createApiToken(page);
	return { user, family, list, item, token, url: itemUrl(family.id, list.id, item.id) };
}

test('sin Bearer responde 401 en PATCH y DELETE sin tocar el item', async ({ request }) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	const list = await createList({ familyId: family.id });
	const item = await createItem({ listId: list.id, name: 'Pan' });
	const url = itemUrl(family.id, list.id, item.id);

	const patch = await request.patch(url, { data: { purchased: true } });
	expect(patch.status()).toBe(401);
	expect(await patch.json()).toEqual(UNAUTHORIZED);

	const del = await request.delete(url);
	expect(del.status()).toBe(401);
	expect(await del.json()).toEqual(UNAUTHORIZED);

	expect(await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
		name: 'Pan',
		purchased: false
	});
});

test('token de un usuario ajeno a la familia responde 403 sin tocar el item', async ({
	page,
	request
}) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	const list = await createList({ familyId: family.id, name: 'Privada' });
	const item = await createItem({ listId: list.id, name: 'Pan' });

	const outsider = await createUser();
	await createFamily({ owner: outsider });
	await seedSession(page, outsider);
	const token = await createApiToken(page);
	const url = itemUrl(family.id, list.id, item.id);

	const patch = await request.patch(url, { headers: bearer(token), data: { purchased: true } });
	expect(patch.status()).toBe(403);
	expect(await patch.json()).toEqual(FORBIDDEN);

	const del = await request.delete(url, { headers: bearer(token) });
	expect(del.status()).toBe(403);
	expect(await del.json()).toEqual(FORBIDDEN);

	expect(await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
		name: 'Pan',
		purchased: false
	});
});

test('un item de otra lista, de otra familia o inexistente responde 404 y sigue intacto', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Semanal' });
	const otherList = await createList({ familyId: family.id, name: 'Fiesta' });
	const otherListItem = await createItem({ listId: otherList.id, name: 'Patatas' });
	// El usuario es miembro también de la otra familia: el 404 es por el
	// cruce de la URL, no por falta de pertenencia (eso sería 403).
	const other = await createFamily({ owner: await createUser() });
	await addFamilyMember({ familyId: other.id, user });
	const foreignList = await createList({ familyId: other.id, name: 'De la otra familia' });
	const foreignItem = await createItem({ listId: foreignList.id, name: 'Pan' });
	await seedSession(page, user);
	const token = await createApiToken(page);

	const urls = {
		// Item real de la familia, pero colgado de OTRA lista que la de la URL.
		otherList: itemUrl(family.id, list.id, otherListItem.id),
		// Lista e item reales, pero de otra familia que la de la URL.
		crossFamily: itemUrl(family.id, foreignList.id, foreignItem.id),
		// Item de otra familia bajo una lista propia.
		foreignItem: itemUrl(family.id, list.id, foreignItem.id),
		missing: itemUrl(family.id, list.id, 'no-existe')
	};
	for (const [label, url] of Object.entries(urls)) {
		const patch = await request.patch(url, {
			headers: bearer(token),
			data: { name: 'Hackeado', purchased: true }
		});
		expect(patch.status(), label).toBe(404);
		expect(await patch.json(), label).toEqual(NOT_FOUND);
	}

	// El DELETE corta igual en los dos casos.
	for (const url of [urls.otherList, urls.crossFamily]) {
		const del = await request.delete(url, { headers: bearer(token) });
		expect(del.status(), url).toBe(404);
		expect(await del.json(), url).toEqual(NOT_FOUND);
	}

	for (const [id, name] of [
		[otherListItem.id, 'Patatas'],
		[foreignItem.id, 'Pan']
	]) {
		expect(await prisma.item.findUniqueOrThrow({ where: { id } })).toMatchObject({
			name,
			purchased: false
		});
	}
});

test('PATCH: payload inválido responde 422 con el envelope (400 si no es JSON) y no cambia el item', async ({
	page,
	request
}) => {
	const { item, token, url } = await seedOwnItem(page);

	const cases = [
		{ payload: { quantity: 0 }, field: 'quantity' },
		{ payload: { quantity: -1 }, field: 'quantity' },
		{ payload: { unit: 'bucket' }, field: 'unit' },
		{ payload: { name: '' }, field: 'name' },
		{ payload: { purchased: 'yes' }, field: 'purchased' },
		{ payload: { order: -1 }, field: 'order' },
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

	const notJson = await request.patch(url, {
		headers: { ...bearer(token), 'content-type': 'application/json' },
		data: Buffer.from('{no es json')
	});
	expect(notJson.status()).toBe(400);
	expect(await notJson.json()).toEqual({
		error: { code: 'invalid_json', message: 'Request body must be JSON' }
	});

	const stored = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
	expect(stored).toMatchObject({ name: 'Leche', unit: 'liter', purchased: false, order: 0 });
	expect(Number(stored.quantity)).toBe(2);
});

test('PATCH purchased: true marca el item, visible en el GET y en la web', async ({
	page,
	request
}) => {
	const { family, list, item, token, url } = await seedOwnItem(page, { login: true });
	await createItem({ listId: list.id, name: 'Pan', order: 1 });

	const response = await request.patch(url, { headers: bearer(token), data: { purchased: true } });

	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
	expect(response.headers()['cache-control']).toBe('no-store');
	// Solo cambia `purchased`: el resto del item se conserva.
	expect(await response.json()).toEqual({
		id: item.id,
		name: 'Leche',
		quantity: 2,
		unit: 'liter',
		categoryId: null,
		categoryName: null,
		purchased: true,
		order: 0
	});

	// El GET de la lista lo ve comprado (y detrás de los pendientes).
	const detail = await request.get(`/api/v1/families/${family.id}/lists/${list.id}`, {
		headers: bearer(token)
	});
	expect(detail.status()).toBe(200);
	expect(await detail.json()).toMatchObject({
		itemCount: 2,
		pendingCount: 1,
		items: [
			{ name: 'Pan', purchased: false },
			{ id: item.id, purchased: true }
		]
	});

	// La web lo pinta en «Comprados», tachado y con el checkbox para desmarcar.
	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: 'Comprados' })).toBeVisible();
	const leche = page.locator('li', { hasText: 'Leche' });
	await expect(leche).toHaveClass(/opacity-60/);
	await expect(leche.locator('p').first()).toHaveClass(/line-through/);
	await expect(leche.getByRole('checkbox', { name: 'Marcar como pendiente' })).toBeVisible();

	// Y `purchased: false` lo devuelve a pendientes.
	const unmark = await request.patch(url, { headers: bearer(token), data: { purchased: false } });
	expect(unmark.status()).toBe(200);
	expect(await unmark.json()).toMatchObject({ id: item.id, purchased: false });
});

test('PATCH de campos: nombre, cantidad, unidad, categoría y order; parcial y visible en el GET', async ({
	page,
	request
}) => {
	const { user, family, list, item, token, url } = await seedOwnItem(page);
	const limpieza = await createCategory({ familyId: family.id, name: 'Limpieza' });
	const pan = await createItem({ listId: list.id, name: 'Pan', order: 1 });

	const response = await request.patch(url, {
		headers: bearer(token),
		data: { name: 'Lejía', quantity: 1.5, unit: 'package', categoryId: limpieza.id, order: 5 }
	});
	expect(response.status()).toBe(200);
	const updated = await response.json();
	expect(updated).toEqual({
		id: item.id,
		name: 'Lejía',
		quantity: 1.5,
		unit: 'package',
		categoryId: limpieza.id,
		categoryName: 'Limpieza',
		purchased: false,
		order: 5
	});

	// Parcial: solo la cantidad; la categoría (ausente) se conserva.
	const partial = await request.patch(url, { headers: bearer(token), data: { quantity: 3 } });
	expect(partial.status()).toBe(200);
	expect(await partial.json()).toEqual({ ...updated, quantity: 3 });

	// `category: null` la quita.
	const uncategorized = await request.patch(url, {
		headers: bearer(token),
		data: { category: null }
	});
	expect(uncategorized.status()).toBe(200);
	const final = await uncategorized.json();
	expect(final).toEqual({ ...updated, quantity: 3, categoryId: null, categoryName: null });

	// El GET devuelve el estado final, con el order nuevo detrás de Pan.
	const detail = await request.get(`/api/v1/families/${family.id}/lists/${list.id}`, {
		headers: bearer(token)
	});
	expect(detail.status()).toBe(200);
	expect((await detail.json()).items).toEqual([expect.objectContaining({ id: pan.id }), final]);

	// La web pinta el item editado por API.
	await seedSession(page, user);
	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Lejía' }).getByText('3 paquete')).toBeVisible();
	await expect(page.locator('li', { hasText: 'Leche' })).toHaveCount(0);
});

test('DELETE: 204 sin body, desaparece del GET y de la web; un segundo DELETE es 404', async ({
	page,
	request
}) => {
	const { family, list, item, token, url } = await seedOwnItem(page);
	const pan = await createItem({ listId: list.id, name: 'Pan', order: 1 });

	const response = await request.delete(url, { headers: bearer(token) });

	expect(response.status()).toBe(204);
	expect(response.headers()['cache-control']).toBe('no-store');
	expect(await response.text()).toBe('');
	expect(await prisma.item.findUnique({ where: { id: item.id } })).toBeNull();

	const detail = await request.get(`/api/v1/families/${family.id}/lists/${list.id}`, {
		headers: bearer(token)
	});
	expect(detail.status()).toBe(200);
	expect(await detail.json()).toMatchObject({
		itemCount: 1,
		items: [{ id: pan.id }]
	});

	// Ya no existe: ni PATCH ni un segundo DELETE.
	const patch = await request.patch(url, { headers: bearer(token), data: { purchased: true } });
	expect(patch.status()).toBe(404);
	expect(await patch.json()).toEqual(NOT_FOUND);
	const again = await request.delete(url, { headers: bearer(token) });
	expect(again.status()).toBe(404);
	expect(await again.json()).toEqual(NOT_FOUND);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Pan' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Leche' })).toHaveCount(0);
});

test('ciclo completo por API: crear, editar, marcar comprado y borrar', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Semanal' });
	await seedSession(page, user);
	const token = await createApiToken(page);
	const listUrl = `/api/v1/families/${family.id}/lists/${list.id}`;

	// Crear.
	const created = await request.post(`${listUrl}/items`, {
		headers: bearer(token),
		data: { name: 'Café', quantity: 1, unit: 'package' }
	});
	expect(created.status()).toBe(201);
	const { id } = await created.json();
	const url = itemUrl(family.id, list.id, id);

	// Editar.
	const edited = await request.patch(url, {
		headers: bearer(token),
		data: { name: 'Café molido', quantity: 2 }
	});
	expect(edited.status()).toBe(200);
	expect(await edited.json()).toMatchObject({ id, name: 'Café molido', quantity: 2 });

	// Marcar comprado.
	const bought = await request.patch(url, { headers: bearer(token), data: { purchased: true } });
	expect(bought.status()).toBe(200);
	expect(await bought.json()).toMatchObject({ id, name: 'Café molido', purchased: true });

	const detail = await request.get(listUrl, { headers: bearer(token) });
	expect(await detail.json()).toMatchObject({
		itemCount: 1,
		pendingCount: 0,
		items: [{ id, name: 'Café molido', quantity: 2, unit: 'package', purchased: true, order: 0 }]
	});

	// La web lo ve comprado.
	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);
	await expect(
		page
			.locator('li', { hasText: 'Café molido' })
			.getByRole('checkbox', { name: 'Marcar como pendiente' })
	).toBeVisible();

	// Borrar.
	const deleted = await request.delete(url, { headers: bearer(token) });
	expect(deleted.status()).toBe(204);

	const after = await request.get(listUrl, { headers: bearer(token) });
	expect(await after.json()).toMatchObject({ itemCount: 0, pendingCount: 0, items: [] });
});
