import { expect, test } from '@playwright/test';
import { bearer, createApiToken } from '../../../../../../../../e2e/helpers/api';
import { loginViaUi, seedSession } from '../../../../../../../../e2e/helpers/auth';
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
