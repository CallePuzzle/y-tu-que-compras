import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Test de INTEGRACIÓN (proyecto vitest `integration`) de PATCH y DELETE de
// /api/v1/families/:familyId/lists/:listId/items/:itemId (tarea #268): los
// handlers reales contra Postgres, con claves REALES del plugin apiKey. La BD
// es la desechable de test (ver `integration-setup.ts`): lo que aquí se crea
// no se limpia.
import { auth } from '#lib/server/auth.js';
import { createCategory } from '#lib/server/categories.js';
import { createItem, getItem, listItems } from '#lib/server/items.js';
import { createList } from '#lib/server/lists.js';
import prisma from '#lib/server/prisma.js';
import { DELETE, PATCH } from './+server.js';

async function userRow(): Promise<string> {
	const id = randomUUID();
	await prisma.user.create({
		data: {
			id,
			name: 'API Item',
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
	const created = await auth.api.createApiKey({ body: { userId, name: 'Item integración' } });
	return created.key;
}

async function newList(familyId: string, name = 'Semanal'): Promise<string> {
	const list = await createList(familyId, { name, color: 'yellow', icon: 'shopping-basket' });
	return list.id;
}

async function newItem(familyId: string, listId: string, name = 'Leche', categoryId?: string) {
	const item = await createItem(familyId, listId, { name, quantity: 2, unit: 'liter', categoryId });
	return item!.id;
}

/** Usuario miembro de una familia nueva con una lista, un item y su token. */
async function setup() {
	const userId = await userRow();
	const familyId = await familyRow();
	await memberRow(familyId, userId);
	const listId = await newList(familyId);
	const itemId = await newItem(familyId, listId);
	return { userId, familyId, listId, itemId, key: await realKey(userId) };
}

/** RequestEvent de un PATCH/DELETE (con body JSON opcional). */
function eventOf(
	method: 'PATCH' | 'DELETE',
	familyId: string,
	listId: string,
	itemId: string,
	token?: string,
	body?: unknown
): Parameters<typeof PATCH>[0] {
	return {
		request: new Request(
			`http://localhost/api/v1/families/${familyId}/lists/${listId}/items/${itemId}`,
			{
				method,
				headers: {
					...(body !== undefined ? { 'content-type': 'application/json' } : {}),
					...(token ? { authorization: `Bearer ${token}` } : {})
				},
				body:
					body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
			}
		),
		params: { familyId, listId, itemId },
		locals: {}
	} as unknown as RequestEvent as Parameters<typeof PATCH>[0];
}

describe('PATCH /api/v1/families/:familyId/lists/:listId/items/:itemId (#268)', () => {
	it('actualiza solo los campos enviados y responde 200 con el item', async () => {
		const { familyId, listId, key } = await setup();
		const lacteos = await createCategory(familyId, { name: 'Lácteos' });
		const itemId = await newItem(familyId, listId, 'Yogur', lacteos.id);

		const response = await PATCH(
			eventOf('PATCH', familyId, listId, itemId, key, { quantity: 6, unit: 'unit' })
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		const expected = {
			id: itemId,
			name: 'Yogur',
			quantity: 6,
			unit: 'unit',
			// Sin categoría en el body: se conserva la que tenía.
			categoryId: lacteos.id,
			categoryName: 'Lácteos',
			purchased: false
		};
		expect(await response.json()).toEqual(expected);
		expect(await getItem(familyId, listId, itemId)).toEqual(expected);
	});

	it('la categoría se cambia por nombre normalizado y null la quita', async () => {
		const { familyId, listId, itemId, key } = await setup();
		const lacteos = await createCategory(familyId, { name: 'Lácteos' });

		const byName = await PATCH(
			eventOf('PATCH', familyId, listId, itemId, key, { category: 'lácteos' })
		);
		expect(await byName.json()).toMatchObject({ categoryId: lacteos.id, name: 'Leche' });

		const cleared = await PATCH(
			eventOf('PATCH', familyId, listId, itemId, key, { categoryId: null })
		);
		expect(cleared.status).toBe(200);
		expect(await cleared.json()).toMatchObject({ categoryId: null, categoryName: null });
	});

	it('el toggle purchased marca y desmarca el item (y lo mueve tras los pendientes)', async () => {
		const { familyId, listId, itemId, key } = await setup();
		const pan = await newItem(familyId, listId, 'Pan');

		const marked = await PATCH(
			eventOf('PATCH', familyId, listId, itemId, key, { purchased: true })
		);
		expect(marked.status).toBe(200);
		expect(await marked.json()).toMatchObject({ id: itemId, purchased: true, name: 'Leche' });
		expect((await listItems(familyId, listId)).map((item) => item.id)).toEqual([pan, itemId]);

		const unmarked = await PATCH(
			eventOf('PATCH', familyId, listId, itemId, key, { purchased: false })
		);
		expect(await unmarked.json()).toMatchObject({ purchased: false });
		expect((await listItems(familyId, listId)).map((item) => item.id)).toEqual([itemId, pan]);
	});

	it('order recoloca el item en la lista', async () => {
		const { familyId, listId, itemId, key } = await setup();
		const pan = await newItem(familyId, listId, 'Pan');
		const huevos = await newItem(familyId, listId, 'Huevos');

		const response = await PATCH(
			eventOf('PATCH', familyId, listId, itemId, key, { order: 10, name: 'Leche entera' })
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ name: 'Leche entera' });
		expect((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).order).toBe(10);
		expect((await listItems(familyId, listId)).map((item) => item.id)).toEqual([
			pan,
			huevos,
			itemId
		]);
	});

	it('un payload inválido (o vacío) responde 422 y no toca el item', async () => {
		const { familyId, listId, itemId, key } = await setup();

		const invalid = await PATCH(
			eventOf('PATCH', familyId, listId, itemId, key, {
				quantity: -1,
				unit: 'barrel',
				purchased: 'yes',
				order: 1.5
			})
		);
		const empty = await PATCH(eventOf('PATCH', familyId, listId, itemId, key, {}));

		expect(invalid.status).toBe(422);
		const error = (await invalid.json()).error;
		expect(error.code).toBe('validation_failed');
		expect(Object.keys(error.details).sort()).toEqual(['order', 'purchased', 'quantity', 'unit']);
		expect(empty.status).toBe(422);
		expect((await empty.json()).error.details._errors).toEqual(['At least one field is required']);
		expect(await getItem(familyId, listId, itemId)).toMatchObject({
			quantity: 2,
			unit: 'liter',
			purchased: false
		});
	});

	it('401 sin token, 403 sin pertenencia y 404 si el item es de otra lista o familia', async () => {
		const { userId, familyId, listId, key } = await setup();
		const otherList = await newList(familyId, 'Otra');
		const otherListItem = await newItem(familyId, otherList, 'Pan');
		const otherFamily = await familyRow();
		await memberRow(otherFamily, userId);
		const foreignList = await newList(otherFamily, 'Ajena');
		const foreignItem = await newItem(otherFamily, foreignList, 'Ajeno');
		const strangerFamily = await familyRow();
		const strangerList = await newList(strangerFamily, 'Privada');
		const strangerItem = await newItem(strangerFamily, strangerList, 'Privado');
		const payload = { purchased: true };

		const unauthorized = await PATCH(
			eventOf('PATCH', familyId, listId, otherListItem, undefined, payload)
		);
		const forbidden = await PATCH(
			eventOf('PATCH', strangerFamily, strangerList, strangerItem, key, payload)
		);
		const wrongList = await PATCH(eventOf('PATCH', familyId, listId, otherListItem, key, payload));
		const wrongFamily = await PATCH(
			eventOf('PATCH', familyId, foreignList, foreignItem, key, payload)
		);
		const missing = await PATCH(eventOf('PATCH', familyId, listId, randomUUID(), key, payload));

		expect(unauthorized.status).toBe(401);
		expect(forbidden.status).toBe(403);
		expect(wrongList.status).toBe(404);
		expect(await wrongList.json()).toEqual({
			error: { code: 'not_found', message: 'Item not found' }
		});
		expect(wrongFamily.status).toBe(404);
		expect(missing.status).toBe(404);
		expect(await getItem(familyId, otherList, otherListItem)).toMatchObject({ purchased: false });
		expect(await getItem(otherFamily, foreignList, foreignItem)).toMatchObject({
			purchased: false
		});
		expect(await getItem(strangerFamily, strangerList, strangerItem)).toMatchObject({
			purchased: false
		});
	});
});

describe('DELETE /api/v1/families/:familyId/lists/:listId/items/:itemId (#268)', () => {
	it('borra el item y responde 204; un segundo DELETE es 404', async () => {
		const { familyId, listId, itemId, key } = await setup();

		const response = await DELETE(eventOf('DELETE', familyId, listId, itemId, key));

		expect(response.status).toBe(204);
		expect(await response.text()).toBe('');
		expect(await getItem(familyId, listId, itemId)).toBeNull();

		const again = await DELETE(eventOf('DELETE', familyId, listId, itemId, key));
		expect(again.status).toBe(404);
		expect(await again.json()).toEqual({ error: { code: 'not_found', message: 'Item not found' } });
	});

	it('401 sin token, 403 sin pertenencia y 404 si el item es de otra lista o familia', async () => {
		const { userId, familyId, listId, key } = await setup();
		const otherList = await newList(familyId, 'Otra');
		const otherListItem = await newItem(familyId, otherList, 'Pan');
		const otherFamily = await familyRow();
		await memberRow(otherFamily, userId);
		const foreignList = await newList(otherFamily, 'Ajena');
		const foreignItem = await newItem(otherFamily, foreignList, 'Ajeno');
		const strangerFamily = await familyRow();
		const strangerList = await newList(strangerFamily, 'Privada');
		const strangerItem = await newItem(strangerFamily, strangerList, 'Privado');

		const unauthorized = await DELETE(eventOf('DELETE', familyId, otherList, otherListItem));
		const forbidden = await DELETE(
			eventOf('DELETE', strangerFamily, strangerList, strangerItem, key)
		);
		const wrongList = await DELETE(eventOf('DELETE', familyId, listId, otherListItem, key));
		const wrongFamily = await DELETE(eventOf('DELETE', familyId, foreignList, foreignItem, key));

		expect(unauthorized.status).toBe(401);
		expect(forbidden.status).toBe(403);
		expect(wrongList.status).toBe(404);
		expect(wrongFamily.status).toBe(404);
		expect(await getItem(familyId, otherList, otherListItem)).not.toBeNull();
		expect(await getItem(otherFamily, foreignList, foreignItem)).not.toBeNull();
		expect(await getItem(strangerFamily, strangerList, strangerItem)).not.toBeNull();
	});
});
