import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Test de INTEGRACIÓN (proyecto vitest `integration`) de
// POST /api/v1/families/:familyId/lists/:listId/items (tarea #268): el
// handler real contra Postgres, con claves REALES del plugin apiKey y
// familias/miembros creados con Prisma. La BD es la desechable de test (ver
// `integration-setup.ts`): lo que aquí se crea no se limpia.
import { auth } from '#lib/server/auth.js';
import { createCategory } from '#lib/server/categories.js';
import { createItem, listItems } from '#lib/server/items.js';
import { createList } from '#lib/server/lists.js';
import prisma from '#lib/server/prisma.js';
import { POST } from './+server.js';

async function userRow(): Promise<string> {
	const id = randomUUID();
	await prisma.user.create({
		data: {
			id,
			name: 'API Items',
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
	const created = await auth.api.createApiKey({ body: { userId, name: 'Items integración' } });
	return created.key;
}

async function newList(familyId: string, name = 'Semanal'): Promise<string> {
	const list = await createList(familyId, { name, color: 'yellow', icon: 'shopping-basket' });
	return list.id;
}

/** Usuario miembro de una familia nueva con una lista y su token. */
async function setup() {
	const userId = await userRow();
	const familyId = await familyRow();
	await memberRow(familyId, userId);
	const listId = await newList(familyId);
	return { userId, familyId, listId, key: await realKey(userId) };
}

/** RequestEvent mínimo de un POST: el handler solo lee `request`, `params` y `locals`. */
function postEventOf(
	familyId: string,
	listId: string,
	token?: string,
	body?: unknown
): Parameters<typeof POST>[0] {
	return {
		request: new Request(`http://localhost/api/v1/families/${familyId}/lists/${listId}/items`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(token ? { authorization: `Bearer ${token}` } : {})
			},
			body: typeof body === 'string' ? body : JSON.stringify(body ?? {})
		}),
		params: { familyId, listId },
		locals: {}
	} as unknown as RequestEvent as Parameters<typeof POST>[0];
}

describe('POST /api/v1/families/:familyId/lists/:listId/items (#268)', () => {
	it('crea el item al final de la lista (order del servidor) y responde 201', async () => {
		const { familyId, listId, key } = await setup();
		const pan = await createItem(familyId, listId, { name: 'Pan', quantity: 1, unit: 'unit' });

		const response = await POST(
			postEventOf(familyId, listId, key, { name: '  Leche  ', quantity: 2.5, unit: 'liter' })
		);

		expect(response.status).toBe(201);
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
		const created = await response.json();
		expect(created).toEqual({
			id: expect.any(String),
			name: 'Leche',
			quantity: 2.5,
			unit: 'liter',
			categoryId: null,
			categoryName: null,
			purchased: false,
			// El `order` lo pone el servidor: detrás del último item de la lista.
			order: pan!.order + 1
		});
		expect((await listItems(familyId, listId)).map((item) => item.name)).toEqual(['Pan', 'Leche']);
	});

	it('resuelve la categoría por id o por nombre normalizado; una ajena queda sin categoría', async () => {
		const { familyId, listId, key } = await setup();
		const otherFamily = await familyRow();
		const lacteos = await createCategory(familyId, { name: 'Lácteos' });
		const foreign = await createCategory(otherFamily, { name: 'Ajena' });

		const byId = await POST(
			postEventOf(familyId, listId, key, {
				name: 'Yogur',
				quantity: 4,
				unit: 'unit',
				categoryId: lacteos.id
			})
		);
		const byName = await POST(
			postEventOf(familyId, listId, key, {
				name: 'Queso',
				quantity: 1,
				unit: 'unit',
				category: '  LACTEOS '
			})
		);
		const foreignId = await POST(
			postEventOf(familyId, listId, key, {
				name: 'Mantequilla',
				quantity: 1,
				unit: 'unit',
				categoryId: foreign.id
			})
		);
		const unknownName = await POST(
			postEventOf(familyId, listId, key, {
				name: 'Nata',
				quantity: 1,
				unit: 'unit',
				category: 'Inventada'
			})
		);

		expect(byId.status).toBe(201);
		expect(await byId.json()).toMatchObject({ categoryId: lacteos.id, categoryName: 'Lácteos' });
		expect(byName.status).toBe(201);
		expect(await byName.json()).toMatchObject({ categoryId: lacteos.id, categoryName: 'Lácteos' });
		expect(foreignId.status).toBe(201);
		expect(await foreignId.json()).toMatchObject({ categoryId: null, categoryName: null });
		expect(unknownName.status).toBe(201);
		expect(await unknownName.json()).toMatchObject({ categoryId: null });
	});

	it('un payload inválido responde 422 con errores por campo y no crea nada', async () => {
		const { familyId, listId, key } = await setup();

		const invalid = await POST(
			postEventOf(familyId, listId, key, { name: '', quantity: 0, unit: 'barrel' })
		);
		const both = await POST(
			postEventOf(familyId, listId, key, {
				name: 'Pan',
				quantity: 1,
				unit: 'unit',
				categoryId: 'x',
				category: 'y'
			})
		);
		const notJson = await POST(postEventOf(familyId, listId, key, '{nope'));

		expect(invalid.status).toBe(422);
		const error = (await invalid.json()).error;
		expect(error).toMatchObject({ code: 'validation_failed', message: 'Invalid request body' });
		expect(Object.keys(error.details).sort()).toEqual(['name', 'quantity', 'unit']);
		expect(both.status).toBe(422);
		expect((await both.json()).error.details._errors).toEqual([
			'Use either categoryId or category, not both'
		]);
		expect(notJson.status).toBe(400);
		expect((await notJson.json()).error.code).toBe('invalid_json');
		expect(await listItems(familyId, listId)).toEqual([]);
	});

	it('401 sin token, 403 sin pertenencia y 404 si la lista es de otra familia o no existe', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		const otherFamily = await familyRow();
		const strangerFamily = await familyRow();
		await memberRow(familyId, userId);
		await memberRow(otherFamily, userId);
		const foreignList = await newList(otherFamily, 'Ajena');
		const strangerList = await newList(strangerFamily, 'Privada');
		const key = await realKey(userId);
		const payload = { name: 'Pan', quantity: 1, unit: 'unit' };

		const unauthorized = await POST(postEventOf(familyId, foreignList, undefined, payload));
		const forbidden = await POST(postEventOf(strangerFamily, strangerList, key, payload));
		const notFound = await POST(postEventOf(familyId, foreignList, key, payload));
		const missing = await POST(postEventOf(familyId, randomUUID(), key, payload));

		expect(unauthorized.status).toBe(401);
		expect(forbidden.status).toBe(403);
		expect(await forbidden.json()).toEqual({
			error: { code: 'forbidden', message: 'Not a member of this family' }
		});
		expect(notFound.status).toBe(404);
		expect(await notFound.json()).toEqual({
			error: { code: 'not_found', message: 'List not found' }
		});
		expect(missing.status).toBe(404);
		expect(await listItems(otherFamily, foreignList)).toEqual([]);
		expect(await listItems(strangerFamily, strangerList)).toEqual([]);
	});
});
