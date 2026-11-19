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
import { createList } from '#lib/server/lists.js';
import prisma from '#lib/server/prisma.js';
import { GET } from './+server.js';

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
