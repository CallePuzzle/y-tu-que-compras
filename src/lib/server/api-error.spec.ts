import { describe, expect, it } from 'vitest';

import {
	API_ERROR_STATUS,
	apiError,
	apiErrorCodeForStatus,
	isApiErrorResponse,
	type ApiErrorCode
} from './api-error.js';
import { apiJson } from './api-response.js';

// El envelope es el contrato de TODOS los errores de /api/v1 (épica #260,
// #279): su forma exacta se fija aquí — igualdad profunda, no `toMatchObject`
// — para que ningún campo heredado de `App.Error` de kit (`status`, `message`
// al nivel superior) se cuele en el JSON del wire.
describe('apiError (envelope de errores de /api/v1, #279)', () => {
	it('devuelve el envelope JSON exacto, con el status del catálogo y las cabeceras de la API', async () => {
		const response = apiError('unauthenticated', 'Missing or invalid API key');

		expect(response.status).toBe(401);
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			error: { code: 'unauthenticated', message: 'Missing or invalid API key' }
		});
	});

	it('fija el mapeo código → status de toda la API', async () => {
		expect(API_ERROR_STATUS).toEqual({
			bad_request: 400,
			invalid_json: 400,
			unauthenticated: 401,
			forbidden: 403,
			not_found: 404,
			method_not_allowed: 405,
			validation_failed: 422,
			rate_limited: 429,
			internal_error: 500
		});
		for (const [code, status] of Object.entries(API_ERROR_STATUS)) {
			const response = apiError(code as ApiErrorCode, 'msg');

			expect(response.status, code).toBe(status);
			expect(await response.json(), code).toEqual({ error: { code, message: 'msg' } });
		}
	});

	it('añade `details` dentro del envelope solo cuando se pasa', async () => {
		const response = apiError('validation_failed', 'Invalid request body', {
			details: { name: ['Too small'] }
		});

		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			error: {
				code: 'validation_failed',
				message: 'Invalid request body',
				details: { name: ['Too small'] }
			}
		});
	});

	it('acepta cabeceras extra sin perder las de la API', () => {
		const response = apiError('rate_limited', 'Too many requests', {
			headers: { 'retry-after': '60' }
		});

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('permite conservar un status fuera del catálogo', async () => {
		const response = apiError('bad_request', 'Payload Too Large', { status: 413 });

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: { code: 'bad_request', message: 'Payload Too Large' }
		});
	});
});

describe('apiErrorCodeForStatus', () => {
	it('mapea cada status al código del catálogo', () => {
		expect(apiErrorCodeForStatus(400)).toBe('bad_request');
		expect(apiErrorCodeForStatus(401)).toBe('unauthenticated');
		expect(apiErrorCodeForStatus(403)).toBe('forbidden');
		expect(apiErrorCodeForStatus(404)).toBe('not_found');
		expect(apiErrorCodeForStatus(405)).toBe('method_not_allowed');
		expect(apiErrorCodeForStatus(413)).toBe('bad_request');
		expect(apiErrorCodeForStatus(422)).toBe('validation_failed');
		expect(apiErrorCodeForStatus(429)).toBe('rate_limited');
		expect(apiErrorCodeForStatus(500)).toBe('internal_error');
		expect(apiErrorCodeForStatus(503)).toBe('internal_error');
	});
});

describe('isApiErrorResponse', () => {
	it('reconoce solo las respuestas de error con el Content-Type de la API', () => {
		expect(isApiErrorResponse(apiError('not_found', 'List not found'))).toBe(true);
		expect(isApiErrorResponse(apiJson({ ok: true }))).toBe(false);
		expect(isApiErrorResponse(new Response('Not Found', { status: 404 }))).toBe(false);
		expect(isApiErrorResponse(Response.json({ message: 'Not Found' }, { status: 404 }))).toBe(
			false
		);
	});
});
