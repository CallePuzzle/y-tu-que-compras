import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Test de INTEGRACIÓN (proyecto vitest `integration`): `requireApiUser` contra
// claves REALES del plugin apiKey, creadas con `auth.api.createApiKey` en su
// camino server-only (sin `request` en el contexto: el plugin entonces acepta
// `body.userId`, que es como el backend las creará por debajo de la UI de la
// US1) y verificadas con el hashing SHA-256 y el lookup reales sobre la tabla
// `apikey`. La BD es la desechable de test (ver `integration-setup.ts`): los
// usuarios y claves que aquí se crean no se limpian detrás.
import { auth } from './auth.js';
import { requireApiUser } from './api-user.js';
import prisma from './prisma.js';

/** Usuario real en la BD, dueño de las claves de cada spec. */
async function userRow(): Promise<string> {
	const id = randomUUID();
	await prisma.user.create({
		data: {
			id,
			name: 'API Integración',
			email: `${id}@integration.test`,
			emailVerified: false,
			createdAt: new Date(),
			updatedAt: new Date()
		}
	});
	return id;
}

/** Clave REAL en claro, recién creada por el plugin para ese usuario. */
async function realKey(userId: string): Promise<string> {
	const created = await auth.api.createApiKey({ body: { userId, name: 'Prueba integración' } });
	expect(created.key).toBeTruthy();
	return created.key;
}

/** RequestEvent mínimo con el Bearer que el helper debe resolver. */
function eventWithBearer(token: string): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/families/fam-1/lists', {
			headers: { authorization: `Bearer ${token}` }
		}),
		locals: {}
	} as unknown as RequestEvent;
}

/** El envelope EXACTO del 401. */
const ENVELOPE = { error: { code: 'unauthenticated', message: 'Missing or invalid API key' } };

describe('requireApiUser contra claves reales (#274)', () => {
	it('una clave real creada por el plugin autentica a su dueño', async () => {
		const userId = await userRow();
		const key = await realKey(userId);

		const result = await requireApiUser(eventWithBearer(key));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.userId).toBe(userId);
			expect(result.key).toMatchObject({
				referenceId: userId,
				name: 'Prueba integración',
				enabled: true
			});
			// El hash jamás sale en el registro verificado.
			expect(result.key).not.toHaveProperty('key');
		}
	});

	it('una clave inventada responde 401 con el envelope', async () => {
		const result = await requireApiUser(eventWithBearer('esta-clave-no-existe'));

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.response.status).toBe(401);
			expect(await result.response.json()).toEqual(ENVELOPE);
		}
	});

	it('una clave revocada (enabled: false) responde 401 con el envelope', async () => {
		const userId = await userRow();
		const key = await realKey(userId);
		const row = await prisma.apikey.findFirstOrThrow({ where: { referenceId: userId } });
		await prisma.apikey.update({ where: { id: row.id }, data: { enabled: false } });

		const result = await requireApiUser(eventWithBearer(key));

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.response.status).toBe(401);
			expect(await result.response.json()).toEqual(ENVELOPE);
		}
	});

	it('una clave caducada responde 401 con el envelope', async () => {
		const userId = await userRow();
		const key = await realKey(userId);
		// Sin `expiresIn` en la creación la clave no caduca nunca (así viene de
		// `defaultExpiresIn: null`); se fuerza la caducidad en la BD, que es el
		// estado exacto que el plugin comprueba al verificar.
		const row = await prisma.apikey.findFirstOrThrow({ where: { referenceId: userId } });
		await prisma.apikey.update({
			where: { id: row.id },
			data: { expiresAt: new Date(Date.now() - 60_000) }
		});

		const result = await requireApiUser(eventWithBearer(key));

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.response.status).toBe(401);
			expect(await result.response.json()).toEqual(ENVELOPE);
		}
	});
});
