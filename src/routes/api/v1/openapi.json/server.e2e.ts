import { expect, test } from '@playwright/test';
import { compileErrors, validate } from '@readme/openapi-parser';

// GET /api/v1/openapi.json (US6 #266, tarea #267) contra el stack completo:
// responde sin sesión ni token (ni el guard la redirige a /login ni la API
// pide Bearer) y lo que sirve valida como OpenAPI 3.1. La correspondencia
// entre la spec y los `+server.ts` la fija `src/lib/server/openapi.spec.ts`.

test('la spec OpenAPI se descarga sin sesión y valida como OpenAPI 3.1', async ({ request }) => {
	const response = await request.get('/api/v1/openapi.json', { maxRedirects: 0 });

	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');

	const spec = await response.json();
	expect(spec.openapi).toMatch(/^3\.1\./);

	const result = await validate(spec);
	expect(result.valid, result.valid ? '' : compileErrors(result)).toBe(true);

	expect(Object.keys(spec.paths)).toEqual(
		expect.arrayContaining([
			'/families/{familyId}/lists',
			'/families/{familyId}/lists/{listId}',
			'/families/{familyId}/lists/{listId}/items',
			'/families/{familyId}/lists/{listId}/items/{itemId}'
		])
	);
	expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
		type: 'http',
		scheme: 'bearer'
	});
	expect(spec.components.responses.RateLimited.headers).toHaveProperty('Retry-After');
});

test('un token inválido no impide descargar la spec', async ({ request }) => {
	const response = await request.get('/api/v1/openapi.json', {
		headers: { authorization: 'Bearer not-a-real-key' }
	});

	expect(response.status()).toBe(200);
});
