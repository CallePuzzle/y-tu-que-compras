import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Test de INTEGRACIÓN (proyecto vitest `integration`) de
// GET /api/v1/families/:familyId/lists (tarea #269): el handler real contra
// Postgres, con claves REALES del plugin apiKey (ver `api-user.int.spec.ts`) y
// familias/miembros creados con Prisma. La BD es la desechable de test (ver
// `integration-setup.ts`): lo que aquí se crea no se limpia.
import { auth } from '#lib/server/auth.js';
import { createList, listLists } from '#lib/server/lists.js';
import prisma from '#lib/server/prisma.js';
import { GET, POST } from './+server.js';

async function userRow(): Promise<string> {
	const id = randomUUID();
	await prisma.user.create({
		data: {
			id,
			name: 'API Listas',
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
	const created = await auth.api.createApiKey({ body: { userId, name: 'Listas integración' } });
	return created.key;
}

/** RequestEvent mínimo: el handler solo lee `request`, `params` y `locals`. */
function eventOf(familyId: string, token?: string): Parameters<typeof GET>[0] {
	return {
		request: new Request(`http://localhost/api/v1/families/${familyId}/lists`, {
			headers: token ? { authorization: `Bearer ${token}` } : {}
		}),
		params: { familyId },
		locals: {}
	} as unknown as RequestEvent as Parameters<typeof GET>[0];
}

describe('GET /api/v1/families/:familyId/lists (#269)', () => {
	it('con token válido y pertenencia responde 200 con las listas de la familia', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		const otherFamily = await familyRow();
		await memberRow(familyId, userId);
		const list = await createList(familyId, {
			name: 'Semanal',
			color: 'yellow',
			icon: 'shopping-basket'
		});
		await createList(otherFamily, { name: 'Ajena', color: 'yellow', icon: 'shopping-basket' });

		const response = await GET(eventOf(familyId, await realKey(userId)));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual([
			{
				id: list.id,
				name: 'Semanal',
				color: 'yellow',
				icon: 'shopping-basket',
				itemCount: 0,
				pendingCount: 0
			}
		]);
	});

	it('sin token responde 401 con el envelope', async () => {
		const familyId = await familyRow();

		const response = await GET(eventOf(familyId));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: { code: 'unauthorized', message: 'Missing or invalid API key' }
		});
	});

	it('sin pertenencia responde 403 aunque la familia exista', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await createList(familyId, { name: 'Privada', color: 'yellow', icon: 'shopping-basket' });

		const response = await GET(eventOf(familyId, await realKey(userId)));

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: { code: 'forbidden', message: 'Not a member of this family' }
		});
	});

	it('una familia inexistente responde también 403 (no revela si existe)', async () => {
		const userId = await userRow();

		const response = await GET(eventOf(randomUUID(), await realKey(userId)));

		expect(response.status).toBe(403);
	});
});

/** RequestEvent de un POST con body (string tal cual: así se prueba el JSON roto). */
function postEventOf(familyId: string, body: unknown, token?: string): Parameters<typeof POST>[0] {
	return {
		request: new Request(`http://localhost/api/v1/families/${familyId}/lists`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(token ? { authorization: `Bearer ${token}` } : {})
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		params: { familyId },
		locals: {}
	} as unknown as RequestEvent as Parameters<typeof POST>[0];
}

describe('POST /api/v1/families/:familyId/lists (#272)', () => {
	it('con token válido y pertenencia crea la lista y responde 201 con ella', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await memberRow(familyId, userId);

		const response = await POST(
			postEventOf(
				familyId,
				{ name: '  Mercadona  ', color: 'teal', icon: 'apple' },
				await realKey(userId)
			)
		);

		expect(response.status).toBe(201);
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		const created = await response.json();
		expect(created).toEqual({
			id: expect.any(String),
			name: 'Mercadona',
			color: 'teal',
			icon: 'apple',
			itemCount: 0,
			pendingCount: 0
		});
		// Persistida en la familia de la URL.
		expect(await listLists(familyId)).toEqual([created]);
	});

	it('un payload inválido responde 422 con errores por campo y no crea nada', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await memberRow(familyId, userId);

		const response = await POST(
			postEventOf(familyId, { name: '', color: 'fucsia' }, await realKey(userId))
		);

		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error).toMatchObject({
			code: 'validation_failed',
			message: 'Invalid request body'
		});
		expect(Object.keys(body.error.details).sort()).toEqual(['color', 'icon', 'name']);
		expect(await listLists(familyId)).toEqual([]);
	});

	it('un body que no es JSON responde 400 invalid_json', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		await memberRow(familyId, userId);

		const response = await POST(postEventOf(familyId, '{roto', await realKey(userId)));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: 'invalid_json', message: 'Request body must be JSON' }
		});
	});

	it('sin token responde 401 y sin pertenencia 403, sin crear nada', async () => {
		const userId = await userRow();
		const familyId = await familyRow();
		const payload = { name: 'Intrusa', color: 'red', icon: 'gift' };

		const unauthorized = await POST(postEventOf(familyId, payload));
		const forbidden = await POST(postEventOf(familyId, payload, await realKey(userId)));

		expect(unauthorized.status).toBe(401);
		expect(forbidden.status).toBe(403);
		expect(await forbidden.json()).toEqual({
			error: { code: 'forbidden', message: 'Not a member of this family' }
		});
		expect(await listLists(familyId)).toEqual([]);
	});
});
