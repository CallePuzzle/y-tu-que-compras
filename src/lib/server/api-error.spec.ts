import { describe, expect, it } from 'vitest';

import { apiError } from './api-error.js';

// El envelope es el contrato de TODOS los errores de /api/v1 (épica #260): su
// forma exacta se fija aquí — igualdad profunda, no `toMatchObject` — para que
// ningún campo heredado de `App.Error` de kit (`status`, `message` al nivel
// superior) se cuele en el JSON del wire.
describe('apiError (envelope de errores de /api/v1, #274)', () => {
	it('devuelve el envelope JSON exacto con el status dado', async () => {
		const response = apiError(401, 'unauthorized', 'Missing or invalid API key');

		expect(response.status).toBe(401);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({
			error: { code: 'unauthorized', message: 'Missing or invalid API key' }
		});
	});

	it('sirve para el resto de errores de la API (404, 429...) con el mismo envelope', async () => {
		for (const [status, code, message] of [
			[403, 'forbidden', 'Not a member of this family'],
			[404, 'not_found', 'List not found'],
			[429, 'rate_limited', 'Too many requests']
		] as const) {
			const response = apiError(status, code, message);

			expect(response.status).toBe(status);
			expect(await response.json()).toEqual({ error: { code, message } });
		}
	});
});
