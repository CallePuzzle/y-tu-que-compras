import { describe, expect, it } from 'vitest';

import { apiJson } from './api-response.js';

describe('apiJson (respuestas de éxito de /api/v1, #269)', () => {
	it('serializa a JSON con charset explícito y sin caché', async () => {
		const response = apiJson([{ id: 'l1', name: 'Semanal' }]);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual([{ id: 'l1', name: 'Semanal' }]);
	});

	it('acepta otro status', () => {
		expect(apiJson({ ok: true }, 201).status).toBe(201);
	});
});
