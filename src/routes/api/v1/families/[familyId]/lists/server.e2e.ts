import { expect, test } from '@playwright/test';
import { bearer, createApiToken } from '../../../../../../../e2e/helpers/api';
import { loginViaUi, seedSession } from '../../../../../../../e2e/helpers/auth';
import { prisma } from '../../../../../../../e2e/helpers/db';
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
// Bearer. El plugin limita cada clave a 60 peticiones por minuto (#271):
// con `resetDb` por test cada uno estrena las suyas y no se acerca al límite.
//
// POST (US3 #263, tarea #277) va al final: 201 con la `ListView`, 403 sin
// pertenencia y 400/422 con el envelope de error y los `details` por campo.

const UNAUTHORIZED = { error: { code: 'unauthenticated', message: 'Missing or invalid API key' } };
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

// --- POST /api/v1/families/:familyId/lists (US3 #263, tarea #277) ---

test('POST: token de un usuario ajeno a la familia responde 403 y no crea nada', async ({
	page,
	request
}) => {
	const owner = await createUser();
	const family = await createFamily({ owner });
	const outsider = await createUser();
	await createFamily({ owner: outsider });
	await seedSession(page, outsider);
	const token = await createApiToken(page);

	const response = await request.post(`/api/v1/families/${family.id}/lists`, {
		headers: bearer(token),
		data: { name: 'Intrusa', color: 'red', icon: 'gift' }
	});

	expect(response.status()).toBe(403);
	expect(await response.json()).toEqual(FORBIDDEN);
	expect(await prisma.list.count()).toBe(0);
});

test('POST: payload inválido responde 422 con el envelope y los errores por campo', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await seedSession(page, user);
	const token = await createApiToken(page);
	const url = `/api/v1/families/${family.id}/lists`;
	const valid = { name: 'Semanal', color: 'green', icon: 'apple' };

	// Cada caso rompe un solo campo: `details` lleva exactamente ese campo.
	const cases = [
		{ payload: { ...valid, name: '   ' }, field: 'name' },
		{ payload: { ...valid, color: 'fucsia' }, field: 'color' },
		{ payload: { ...valid, icon: 'rocket' }, field: 'icon' }
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

	// Body que no es JSON: 400, no hay nada que validar.
	const notJson = await request.post(url, {
		headers: { ...bearer(token), 'content-type': 'application/json' },
		// Buffer: con un string y content-type JSON, Playwright lo serializaría a JSON.
		data: Buffer.from('{esto no es json')
	});
	expect(notJson.status()).toBe(400);
	expect(await notJson.json()).toEqual({
		error: { code: 'invalid_json', message: 'Request body must be JSON' }
	});

	expect(await prisma.list.count()).toBe(0);
});

test('POST camino feliz: 201 con la ListView y la lista visible luego en el GET', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await loginViaUi(page, user.email);
	const token = await createApiToken(page);
	const url = `/api/v1/families/${family.id}/lists`;

	const response = await request.post(url, {
		headers: bearer(token),
		// El nombre se recorta como en el formulario web.
		data: { name: '  Fiesta  ', color: 'purple', icon: 'gift' }
	});

	expect(response.status()).toBe(201);
	expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
	expect(response.headers()['cache-control']).toBe('no-store');
	const created = await response.json();
	expect(created).toEqual({
		id: expect.any(String),
		name: 'Fiesta',
		color: 'purple',
		icon: 'gift',
		itemCount: 0,
		pendingCount: 0
	});

	// Se creó en la familia de la URL y el GET de US2 la devuelve tal cual.
	const stored = await prisma.list.findUniqueOrThrow({ where: { id: created.id } });
	expect(stored.organizationId).toBe(family.id);
	const list = await request.get(url, { headers: bearer(token) });
	expect(list.status()).toBe(200);
	expect(await list.json()).toEqual([created]);
});
