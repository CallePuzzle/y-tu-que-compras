import { expect, test } from '@playwright/test';
import { bearer, createApiToken } from '../../../../../../../e2e/helpers/api';
import { loginViaUi, seedSession } from '../../../../../../../e2e/helpers/auth';
import {
	addFamilyMember,
	createFamily,
	createItem,
	createList,
	createUser,
	resetDb
} from '../../../../../../../e2e/helpers/seed';

// GET /api/v1/families/:familyId/lists (US2 #262, tarea #276) contra el stack
// completo: dev server real, BD de test y tokens REALES del plugin apiKey
// creados por HTTP con la sesión de la usuaria. Las peticiones a la API van
// con el fixture `request` (contexto sin cookies): la única credencial es el
// Bearer. Ojo: el plugin limita cada clave a 10 peticiones al día; con
// `resetDb` por test cada uno estrena las suyas.

const UNAUTHORIZED = { error: { code: 'unauthorized', message: 'Missing or invalid API key' } };
const FORBIDDEN = { error: { code: 'forbidden', message: 'Not a member of this family' } };

test.beforeEach(async () => {
	await resetDb();
});

test('sin Bearer responde 401 con el envelope de error', async ({ request }) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	await createList({ familyId: family.id });

	const response = await request.get(`/api/v1/families/${family.id}/lists`);

	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual(UNAUTHORIZED);
});

test('un Bearer que no es una clave válida responde 401', async ({ request }) => {
	const owner = await createUser();
	const family = await createFamily({ owner });

	const response = await request.get(`/api/v1/families/${family.id}/lists`, {
		headers: bearer('clave-inventada')
	});

	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual(UNAUTHORIZED);
});

test('la cookie de sesión NO sirve como credencial de la API', async ({ page }) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	await seedSession(page, owner);

	// `page.request` comparte las cookies del contexto: sesión válida, sin Bearer.
	const response = await page.request.get(`/api/v1/families/${family.id}/lists`);

	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual(UNAUTHORIZED);
});

test('token de un usuario ajeno a la familia responde 403', async ({ page, request }) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	await createList({ familyId: family.id, name: 'Privada' });

	// La intrusa tiene su propia familia (y su token es válido), pero no es
	// miembro de la de la URL.
	const outsider = await createUser();
	await createFamily({ owner: outsider });
	await seedSession(page, outsider);
	const token = await createApiToken(page);

	const response = await request.get(`/api/v1/families/${family.id}/lists`, {
		headers: bearer(token)
	});

	expect(response.status()).toBe(403);
	expect(await response.json()).toEqual(FORBIDDEN);
});

test('una familia inexistente responde 403, igual que una ajena', async ({ page, request }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);
	const token = await createApiToken(page);

	const response = await request.get('/api/v1/families/no-existe/lists', {
		headers: bearer(token)
	});

	expect(response.status()).toBe(403);
	expect(await response.json()).toEqual(FORBIDDEN);
});

test('camino feliz: login OTP real, token y 200 con las ListView de la familia de la URL', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const semanal = await createList({ familyId: family.id, name: 'Semanal', color: 'yellow' });
	await createItem({ listId: semanal.id, name: 'Pan' });
	await createItem({ listId: semanal.id, name: 'Leche', purchased: true });
	const fiesta = await createList({
		familyId: family.id,
		name: 'Fiesta',
		color: 'blue',
		icon: 'gift'
	});

	// Otra familia de la que también es miembro (rol member): sus listas no
	// deben colarse; manda la familia de la URL, no la cookie de familia activa.
	const other = await createFamily({ owner: await createUser() });
	await addFamilyMember({ familyId: other.id, user });
	await createList({ familyId: other.id, name: 'De la otra familia' });

	await loginViaUi(page, user.email);
	const token = await createApiToken(page);

	const response = await request.get(`/api/v1/families/${family.id}/lists`, {
		headers: bearer(token)
	});

	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
	expect(response.headers()['cache-control']).toBe('no-store');
	// Orden de creación en la app; aquí las dos filas se siembran en el mismo
	// milisegundo posible, así que se aserta el contenido sin depender del empate.
	const body = await response.json();
	expect(body).toHaveLength(2);
	expect(body).toEqual(
		expect.arrayContaining([
			{
				id: semanal.id,
				name: 'Semanal',
				color: 'yellow',
				icon: semanal.icon,
				itemCount: 2,
				pendingCount: 1
			},
			{
				id: fiesta.id,
				name: 'Fiesta',
				color: 'blue',
				icon: 'gift',
				itemCount: 0,
				pendingCount: 0
			}
		])
	);
});
