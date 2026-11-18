import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Spec de SERVIDOR sin base de datos (tarea #274): el módulo de auth entero va
// mockeado — construir better-auth real no hace falta para decidir qué hace
// `requireApiUser` con cada respuesta del verify — y ni prisma ni Postgres
// entran en el camino. El contrato contra una clave REAL (hashing del plugin,
// revocación y caducidad en la BD) lo cubre `api-user.int.spec.ts`.
vi.mock('./auth.js', () => ({
	auth: { api: { verifyApiKey: vi.fn() } }
}));

import { auth } from './auth.js';
import { requireApiUser, type ApiUserResult } from './api-user.js';

const verifyApiKey = auth.api.verifyApiKey as unknown as ReturnType<typeof vi.fn>;

/** RequestEvent mínimo: al helper solo le importan las cabeceras (y `locals.log`). */
function eventOf(headers: Record<string, string> = {}): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/families/fam-1/lists', { headers }),
		locals: {}
	} as unknown as RequestEvent;
}

/** Registro de clave verificado tal y como lo devuelve el plugin (sin el hash). */
function verifiedKeyOf(userId: string) {
	return {
		id: 'key-1',
		referenceId: userId,
		start: 'AbCdEf',
		prefix: null,
		name: 'Token de prueba',
		enabled: true,
		expiresAt: null,
		remaining: null,
		requestCount: 1,
		permissions: null,
		metadata: null
	};
}

/** El envelope EXACTO del 401 (sin campos heredados de App.Error). */
const ENVELOPE = { error: { code: 'unauthorized', message: 'Missing or invalid API key' } };

/** El resultado ha de ser un fallo; devuelve su Response para asertarla. */
async function failureOf(result: Promise<ApiUserResult>): Promise<Response> {
	const settled = await result;
	if (settled.ok) {
		throw new Error('Se esperaba un fallo de autenticación y el verify autenticó');
	}
	return settled.response;
}

/** El resultado ha de autenticar; devuelve el userId y la clave entregados. */
async function successOf(
	result: Promise<ApiUserResult>
): Promise<{ userId: string; key: unknown }> {
	const settled = await result;
	if (!settled.ok) {
		throw new Error(`Se esperaba éxito y el verify respondió ${settled.response.status}`);
	}
	return { userId: settled.userId, key: settled.key };
}

beforeEach(() => {
	verifyApiKey.mockReset();
});

describe('requireApiUser: la cabecera (#274)', () => {
	it('sin cabecera Authorization responde 401 y ni siquiera llama al verify', async () => {
		const response = await failureOf(requireApiUser(eventOf()));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(ENVELOPE);
		expect(verifyApiKey).not.toHaveBeenCalled();
	});

	it('una cabecera que no es Bearer (otro esquema) responde 401 sin llamar al verify', async () => {
		const response = await failureOf(
			requireApiUser(eventOf({ authorization: 'Basic dXNlcjpjb250cmFzYXNlZ2E=' }))
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(ENVELOPE);
		expect(verifyApiKey).not.toHaveBeenCalled();
	});

	it('un Bearer sin token responde 401 sin llamar al verify', async () => {
		const response = await failureOf(requireApiUser(eventOf({ authorization: 'Bearer ' })));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(ENVELOPE);
		expect(verifyApiKey).not.toHaveBeenCalled();
	});

	it('el esquema Bearer no distingue mayúsculas (RFC 7235) y pasa el token al verify', async () => {
		verifyApiKey.mockResolvedValue({
			valid: true,
			error: null,
			key: verifiedKeyOf('user-1')
		});

		const { userId } = await successOf(
			requireApiUser(eventOf({ authorization: 'bearer AbCdEfGh' }))
		);

		expect(userId).toBe('user-1');
		expect(verifyApiKey).toHaveBeenCalledExactlyOnceWith({ body: { key: 'AbCdEfGh' } });
	});
});

describe('requireApiUser: la sesión NO autentica (#274)', () => {
	it('una cookie de sesión better-auth sin Bearer recibe el mismo 401 que cualquiera', async () => {
		// La API no usa el estado del navegador: aunque el handle de better-auth
		// dejara `locals.user` relleno, este helper solo mira el Bearer.
		const response = await failureOf(
			requireApiUser(eventOf({ cookie: 'better-auth.session_token=tok.firma; Path=/; HttpOnly' }))
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(ENVELOPE);
		expect(verifyApiKey).not.toHaveBeenCalled();
	});
});

describe('requireApiUser: verificación del plugin (#274)', () => {
	it('con una clave válida devuelve el userId del dueño y la clave verificada', async () => {
		verifyApiKey.mockResolvedValue({
			valid: true,
			error: null,
			key: verifiedKeyOf('user-42')
		});

		const { userId, key } = await successOf(
			requireApiUser(eventOf({ authorization: 'Bearer clave-en-claro' }))
		);

		expect(userId).toBe('user-42');
		expect(key).toMatchObject({ id: 'key-1', referenceId: 'user-42', enabled: true });
		expect(verifyApiKey).toHaveBeenCalledExactlyOnceWith({ body: { key: 'clave-en-claro' } });
	});

	it('una clave inexistente (KEY_NOT_FOUND) responde 401 con el envelope', async () => {
		verifyApiKey.mockResolvedValue({
			valid: false,
			error: { message: 'API key not found', code: 'KEY_NOT_FOUND' },
			key: null
		});

		const response = await failureOf(
			requireApiUser(eventOf({ authorization: 'Bearer clave-inexistente' }))
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(ENVELOPE);
	});

	it('una clave revocada (KEY_DISABLED) responde 401 con el envelope', async () => {
		verifyApiKey.mockResolvedValue({
			valid: false,
			error: { message: 'API key is disabled', code: 'KEY_DISABLED' },
			key: null
		});

		const response = await failureOf(
			requireApiUser(eventOf({ authorization: 'Bearer clave-revocada' }))
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(ENVELOPE);
	});

	it('una clave caducada (KEY_EXPIRED) responde 401 con el envelope', async () => {
		verifyApiKey.mockResolvedValue({
			valid: false,
			error: { message: 'API key is expired', code: 'KEY_EXPIRED' },
			key: null
		});

		const response = await failureOf(
			requireApiUser(eventOf({ authorization: 'Bearer clave-caducada' }))
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(ENVELOPE);
	});

	it('un éxito sin registro de clave (defensivo) también responde 401', async () => {
		verifyApiKey.mockResolvedValue({ valid: true, error: null, key: null });

		const response = await failureOf(
			requireApiUser(eventOf({ authorization: 'Bearer clave-sin-registro' }))
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(ENVELOPE);
	});

	it('un fallo inesperado del verify (BD caída) se propaga: kit lo convertirá en 500', async () => {
		verifyApiKey.mockRejectedValue(new Error('conexión a la BD rechazada'));

		await expect(requireApiUser(eventOf({ authorization: 'Bearer la-que-sea' }))).rejects.toThrow(
			'conexión a la BD rechazada'
		);
	});
});
