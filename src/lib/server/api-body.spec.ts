import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { readApiBody, validateApiBody } from './api-body.js';

const schema = z.object({ name: z.string().min(1), size: z.number().optional() });

function requestOf(body: string): Request {
	return new Request('http://localhost/api/v1/x', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body
	});
}

describe('readApiBody / validateApiBody (#272)', () => {
	it('devuelve los datos parseados si el body cumple el schema', async () => {
		const result = await readApiBody(requestOf('{"name":"Leche","extra":1}'), schema);

		expect(result).toEqual({ ok: true, data: { name: 'Leche' } });
	});

	it('un body que no es JSON responde 400 invalid_json', async () => {
		const result = await readApiBody(requestOf('no es json'), schema);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.response.status).toBe(400);
		expect(await result.response.json()).toEqual({
			error: { code: 'invalid_json', message: 'Request body must be JSON' }
		});
	});

	it('un JSON inválido para el schema responde 422 con errores por campo', async () => {
		const result = await readApiBody(requestOf('{"name":"","size":"x"}'), schema);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.response.status).toBe(422);
		expect(result.response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		const body = await result.response.json();
		expect(body.error.code).toBe('validation_failed');
		expect(body.error.message).toBe('Invalid request body');
		expect(Object.keys(body.error.details).sort()).toEqual(['name', 'size']);
		expect(body.error.details.name).toEqual([expect.any(String)]);
	});

	it('un body que no es un objeto deja el error en details._errors', async () => {
		const result = validateApiBody(schema, ['no', 'objeto']);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.response.status).toBe(422);
		const body = await result.response.json();
		expect(body.error.details._errors).toEqual([expect.any(String)]);
	});
});
