import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Test de INTEGRACIÓN (proyecto vitest `integration`) de
// GET /api/v1/families/:familyId/lists/:listId (tarea #275): el handler real
// contra Postgres, con claves REALES del plugin apiKey y familias/miembros
// creados con Prisma. La BD es la desechable de test (ver
// `integration-setup.ts`): lo que aquí se crea no se limpia.
import { auth } from '#lib/server/auth.js';
import { createItem, setItemPurchased } from '#lib/server/items.js';
import { createList, getList } from '#lib/server/lists.js';
import prisma from '#lib/server/prisma.js';
import { DELETE, GET, PATCH } from './+server.js';

async function userRow(): Promise<string> {
	const id = randomUUID();
	await prisma.user.create({
		data: {
			id,
			name: 'API Lista',
			email: `${id}@integration.test`,
			emailVerified: false,
			createdAt: new Date(),
			updatedAt: new Date()
		}
	});
	return id;
}

async function familyRow(): Promise<string> {
	const id = randomUUID();
	await prisma.organization.create({
		data: { id, name: `Familia ${id.slice(0, 8)}`, slug: `familia-${id.slice(0, 13)}` }
	});
	return id;
}

async function memberRow(familyId: string, userId: string): Promise<void> {
	await prisma.member.create({
		data: { id: randomUUID(), contextType: 'organization', contextId: familyId, userId }
	});
}

async function realKey(userId: string): Promise<string> {
	const created = await auth.api.createApiKey({ body: { userId, name: 'Lista integración' } });
	return created.key;
}

async function newList(familyId: string, name = 'Semanal'): Promise<string> {
	const list = await createList(familyId, { name, color: 'yellow', icon: 'shopping-basket' });
	return list.id;
}

/** RequestEvent mínimo: el handler solo lee `request`, `params` y `locals`. */
function eventOf(familyId: string, listId: string, token?: string): Parameters<typeof GET>[0] {
	return {
		request: new Request(`http://localhost/api/v1/families/${familyId}/lists/${listId}`, {
			headers: token ? { authorization: `Bearer ${token}` } : {}
		}),
		params: { familyId, listId },
		locals: {}
	} as unknown as RequestEvent as Parameters<typeof GET>[0];
}

describe('GET /api/v1/families/:familyId/lists/:listId (#275)', () => {
	it('con token válido y pertenencia responde 200 con la lista y sus items en orden visual', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await memberRow(familyId, userId);
		const listId = await newList(familyId);
		const leche = await createItem(familyId, listId, { name: 'Leche', quantity: 2, unit: 'liter' });
		const pan = await createItem(familyId, listId, { name: 'Pan', quantity: 1, unit: 'unit' });
		const huevos = await createItem(familyId, listId, {
			name: 'Huevos',
			quantity: 1,
			unit: 'dozen'
		});
		// Leche comprada: pasa al final, detrás de los pendientes (como la UI).
		await setItemPurchased(familyId, listId, leche!.id, true);

		const response = await GET(eventOf(familyId, listId, await realKey(userId)));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
		const item = (id: string, name: string, quantity: number, unit: string, purchased = false) => ({
			id,
			name,
			quantity,
			unit,
			categoryId: null,
			categoryName: null,
			purchased
		});
		expect(await response.json()).toEqual({
			id: listId,
			name: 'Semanal',
			color: 'yellow',
			icon: 'shopping-basket',
			itemCount: 3,
			pendingCount: 2,
			items: [
				item(pan!.id, 'Pan', 1, 'unit'),
				item(huevos!.id, 'Huevos', 1, 'dozen'),
				item(leche!.id, 'Leche', 2, 'liter', true)
			]
		});
	});

	it('una lista vacía responde 200 con items []', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await memberRow(familyId, userId);
		const listId = await newList(familyId);

		const response = await GET(eventOf(familyId, listId, await realKey(userId)));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ id: listId, itemCount: 0, items: [] });
	});

	it('sin token responde 401 con el envelope', async () => {
		const familyId = await familyRow();
		const listId = await newList(familyId);

		const response = await GET(eventOf(familyId, listId));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: { code: 'unauthorized', message: 'Missing or invalid API key' }
		});
	});

	it('sin pertenencia responde 403 aunque la lista exista', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		const listId = await newList(familyId, 'Privada');

		const response = await GET(eventOf(familyId, listId, await realKey(userId)));

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: { code: 'forbidden', message: 'Not a member of this family' }
		});
	});

	it('una lista de otra familia responde 404 (aunque el usuario sea miembro de ambas)', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		const otherFamily = await familyRow();
		await memberRow(familyId, userId);
		await memberRow(otherFamily, userId);
		const foreignList = await newList(otherFamily, 'Ajena');

		const response = await GET(eventOf(familyId, foreignList, await realKey(userId)));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: { code: 'not_found', message: 'List not found' }
		});
	});

	it('una lista inexistente responde 404', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await memberRow(familyId, userId);

		const response = await GET(eventOf(familyId, randomUUID(), await realKey(userId)));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: { code: 'not_found', message: 'List not found' }
		});
	});
});

/** RequestEvent de un PATCH/DELETE (con body JSON opcional). */
function mutationEventOf(
	method: 'PATCH' | 'DELETE',
	familyId: string,
	listId: string,
	token?: string,
	body?: unknown
): Parameters<typeof PATCH>[0] {
	return {
		request: new Request(`http://localhost/api/v1/families/${familyId}/lists/${listId}`, {
			method,
			headers: {
				...(body !== undefined ? { 'content-type': 'application/json' } : {}),
				...(token ? { authorization: `Bearer ${token}` } : {})
			},
			body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
		}),
		params: { familyId, listId },
		locals: {}
	} as unknown as RequestEvent as Parameters<typeof PATCH>[0];
}

describe('PATCH /api/v1/families/:familyId/lists/:listId (#272)', () => {
	it('actualiza solo los campos enviados y responde 200 con la lista', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await memberRow(familyId, userId);
		const listId = await newList(familyId);
		await createItem(familyId, listId, { name: 'Pan', quantity: 1, unit: 'unit' });

		const response = await PATCH(
			mutationEventOf('PATCH', familyId, listId, await realKey(userId), {
				name: 'Finde',
				icon: 'pizza'
			})
		);

		expect(response.status).toBe(200);
		const expected = {
			id: listId,
			name: 'Finde',
			color: 'yellow',
			icon: 'pizza',
			itemCount: 1,
			pendingCount: 1
		};
		expect(await response.json()).toEqual(expected);
		expect(await getList(familyId, listId)).toEqual(expected);
	});

	it('un payload inválido (o vacío) responde 422 y no toca la lista', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await memberRow(familyId, userId);
		const listId = await newList(familyId);
		const key = await realKey(userId);

		const invalid = await PATCH(
			mutationEventOf('PATCH', familyId, listId, key, { color: 'fucsia' })
		);
		const empty = await PATCH(mutationEventOf('PATCH', familyId, listId, key, {}));

		expect(invalid.status).toBe(422);
		expect((await invalid.json()).error).toMatchObject({
			code: 'validation_failed',
			details: { color: [expect.any(String)] }
		});
		expect(empty.status).toBe(422);
		expect((await empty.json()).error.details._errors).toEqual([
			'At least one of name, color or icon is required'
		]);
		expect(await getList(familyId, listId)).toMatchObject({ name: 'Semanal', color: 'yellow' });
	});

	it('401 sin token, 403 sin pertenencia y 404 si la lista es de otra familia', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		const otherFamily = await familyRow();
		const strangerFamily = await familyRow();
		await memberRow(familyId, userId);
		await memberRow(otherFamily, userId);
		const foreignList = await newList(otherFamily, 'Ajena');
		const strangerList = await newList(strangerFamily, 'Privada');
		const key = await realKey(userId);
		const payload = { name: 'Pirateada' };

		const unauthorized = await PATCH(
			mutationEventOf('PATCH', familyId, foreignList, undefined, payload)
		);
		const forbidden = await PATCH(
			mutationEventOf('PATCH', strangerFamily, strangerList, key, payload)
		);
		const notFound = await PATCH(mutationEventOf('PATCH', familyId, foreignList, key, payload));

		expect(unauthorized.status).toBe(401);
		expect(forbidden.status).toBe(403);
		expect(notFound.status).toBe(404);
		expect(await notFound.json()).toEqual({
			error: { code: 'not_found', message: 'List not found' }
		});
		expect(await getList(otherFamily, foreignList)).toMatchObject({ name: 'Ajena' });
		expect(await getList(strangerFamily, strangerList)).toMatchObject({ name: 'Privada' });
	});
});

describe('DELETE /api/v1/families/:familyId/lists/:listId (#272)', () => {
	it('borra la lista con sus items y responde 204; un segundo DELETE es 404', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await memberRow(familyId, userId);
		const listId = await newList(familyId);
		await createItem(familyId, listId, { name: 'Pan', quantity: 1, unit: 'unit' });
		const key = await realKey(userId);

		const response = await DELETE(mutationEventOf('DELETE', familyId, listId, key));

		expect(response.status).toBe(204);
		expect(await response.text()).toBe('');
		expect(await getList(familyId, listId)).toBeNull();
		expect(await prisma.item.count({ where: { listId } })).toBe(0);

		const again = await DELETE(mutationEventOf('DELETE', familyId, listId, key));
		expect(again.status).toBe(404);
	});

	it('401 sin token, 403 sin pertenencia y 404 si la lista es de otra familia', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		const otherFamily = await familyRow();
		const strangerFamily = await familyRow();
		await memberRow(familyId, userId);
		await memberRow(otherFamily, userId);
		const foreignList = await newList(otherFamily, 'Ajena');
		const strangerList = await newList(strangerFamily, 'Privada');
		const key = await realKey(userId);

		const unauthorized = await DELETE(mutationEventOf('DELETE', familyId, foreignList));
		const forbidden = await DELETE(mutationEventOf('DELETE', strangerFamily, strangerList, key));
		const notFound = await DELETE(mutationEventOf('DELETE', familyId, foreignList, key));

		expect(unauthorized.status).toBe(401);
		expect(forbidden.status).toBe(403);
		expect(await forbidden.json()).toEqual({
			error: { code: 'forbidden', message: 'Not a member of this family' }
		});
		expect(notFound.status).toBe(404);
		expect(await getList(otherFamily, foreignList)).not.toBeNull();
		expect(await getList(strangerFamily, strangerList)).not.toBeNull();
	});
});
