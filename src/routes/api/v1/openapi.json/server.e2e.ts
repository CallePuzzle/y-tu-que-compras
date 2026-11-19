import { expect, test } from '@playwright/test';

// GET /api/v1/openapi.json (US6 #266, tarea #267) contra el stack completo: se
// sirve sin sesión ni token, como JSON. Que la spec valide como OpenAPI 3.1 y
// cuadre con los `+server.ts` lo fija `src/lib/server/openapi.spec.ts`.

test('la spec OpenAPI se sirve sin sesión como JSON', async ({ request }) => {
	const response = await request.get('/api/v1/openapi.json', { maxRedirects: 0 });

	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
	expect((await response.json()).openapi).toMatch(/^3\.1\./);
});

test('un token inválido no impide descargar la spec', async ({ request }) => {
	const response = await request.get('/api/v1/openapi.json', {
		headers: { authorization: 'Bearer not-a-real-key' }
	});

	expect(response.status()).toBe(200);
});
