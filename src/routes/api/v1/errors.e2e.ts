import { expect, test, type APIResponse } from '@playwright/test';
import { bearer, createApiToken } from '../../../../e2e/helpers/api';
import { seedSession } from '../../../../e2e/helpers/auth';
import { createFamily, createUser, resetDb } from '../../../../e2e/helpers/seed';

// Envelope de errores unificado de /api/v1 (US5 #265, tarea #279) contra el
// stack completo: los errores que NO salen de un endpoint — 404 de una ruta
// inexistente, 405 de un método sin handler — llegan con el mismo shape y
// Content-Type que los de los endpoints (cuyos casos fijan los e2e de cada
// ruta), sea cual sea el `Accept` del cliente.

const API_CONTENT_TYPE = 'application/json; charset=utf-8';

async function expectApiError(response: APIResponse, status: number, body: unknown) {
	expect(response.status()).toBe(status);
	expect(response.headers()['content-type']).toBe(API_CONTENT_TYPE);
	expect(await response.json()).toEqual(body);
}

test.beforeEach(async () => {
	await resetDb();
});

test('una ruta inexistente bajo /api/v1 responde 404 con el envelope, también pidiendo HTML', async ({
	request
}) => {
	const notFound = { error: { code: 'not_found', message: 'Not found' } };

	await expectApiError(await request.get('/api/v1/nope'), 404, notFound);
	await expectApiError(
		await request.get('/api/v1/families/x/nope', { headers: { accept: 'text/html' } }),
		404,
		notFound
	);
});

test('un método sin handler responde 405 con el envelope y la cabecera Allow', async ({
	request
}) => {
	const response = await request.put('/api/v1/families/x/lists', { data: {} });

	await expectApiError(response, 405, {
		error: { code: 'method_not_allowed', message: 'Method PUT not allowed' }
	});
	expect(response.headers()['allow']).toContain('GET');
});

test('los errores de los endpoints comparten shape y Content-Type', async ({ page, request }) => {
	const owner = await createUser();
	const outsider = await createUser();
	const family = await createFamily({ owner });
	await seedSession(page, outsider);
	const token = await createApiToken(page);
	const lists = `/api/v1/families/${family.id}/lists`;

	await expectApiError(await request.get(lists), 401, {
		error: { code: 'unauthenticated', message: 'Missing or invalid API key' }
	});
	await expectApiError(await request.get(lists, { headers: bearer(token) }), 403, {
		error: { code: 'forbidden', message: 'Not a member of this family' }
	});
});
