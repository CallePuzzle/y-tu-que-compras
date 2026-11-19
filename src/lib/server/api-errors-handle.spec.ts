import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';

import { apiError } from './api-error.js';
import { handleApiErrors, isApiPathname } from './api-errors-handle.js';
import { apiJson } from './api-response.js';

// Red de seguridad del envelope (#279): los errores que no salen de un
// endpoint (404/405 de kit, 500 no controlados) se reescriben al envelope en
// /api/v1/**, y el resto de la app no se toca.

const API_CONTENT_TYPE = 'application/json; charset=utf-8';

function eventFor(
	pathname: string,
	{ method = 'GET', errorId = undefined as string | undefined } = {}
) {
	const log = { error: vi.fn(), info: vi.fn() };
	const event = {
		url: new URL(`http://localhost${pathname}`),
		request: new Request(`http://localhost${pathname}`, { method }),
		locals: { log, errorId }
	} as unknown as RequestEvent;
	return { event, log };
}

async function run(event: RequestEvent, resolve: () => Response | Promise<Response>) {
	return handleApiErrors({ event, resolve: vi.fn(resolve) } as never);
}

describe('isApiPathname', () => {
	it('solo cubre /api/v1/**', () => {
		expect(isApiPathname('/api/v1/families/x/lists')).toBe(true);
		expect(isApiPathname('/api/v1/nope')).toBe(true);
		expect(isApiPathname('/api/auth/sign-in')).toBe(false);
		expect(isApiPathname('/lists')).toBe(false);
	});
});

describe('handleApiErrors', () => {
	it('fuera de la API devuelve la respuesta tal cual', async () => {
		const original = new Response('<h1>Not found</h1>', { status: 404 });
		const { event } = eventFor('/lists/nope');

		expect(await run(event, () => original)).toBe(original);
	});

	it('deja pasar los éxitos y los errores que ya llevan el envelope', async () => {
		const ok = apiJson([]);
		const forbidden = apiError('forbidden', 'Not a member of this family');

		expect(await run(eventFor('/api/v1/a').event, () => ok)).toBe(ok);
		expect(await run(eventFor('/api/v1/a').event, () => forbidden)).toBe(forbidden);
	});

	it('reescribe el 404 de kit (HTML o JSON App.Error) al envelope', async () => {
		for (const original of [
			new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } }),
			Response.json({ message: 'Not Found' }, { status: 404 })
		]) {
			const response = await run(eventFor('/api/v1/nope').event, () => original);

			expect(response.status).toBe(404);
			expect(response.headers.get('content-type')).toBe(API_CONTENT_TYPE);
			expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
		}
	});

	it('reescribe el 405 de kit conservando la cabecera Allow', async () => {
		const original = new Response('PUT method not allowed', {
			status: 405,
			headers: { allow: 'GET, POST, HEAD' }
		});
		const { event } = eventFor('/api/v1/families/x/lists', { method: 'PUT' });

		const response = await run(event, () => original);

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('GET, POST, HEAD');
		expect(await response.json()).toEqual({
			error: { code: 'method_not_allowed', message: 'Method PUT not allowed' }
		});
	});

	it('reescribe el 500 de un error no controlado con el errorId de handleError', async () => {
		const { event } = eventFor('/api/v1/a', { errorId: 'err-123' });

		const response = await run(event, () => new Response('Internal Error', { status: 500 }));

		expect(response.status).toBe(500);
		expect(response.headers.get('content-type')).toBe(API_CONTENT_TYPE);
		expect(await response.json()).toEqual({
			error: {
				code: 'internal_error',
				message: 'Internal server error',
				details: { errorId: 'err-123' }
			}
		});
	});

	it('convierte una excepción de la cadena de handles en el 500 JSON y la registra', async () => {
		const { event, log } = eventFor('/api/v1/a');

		const response = await run(event, () => {
			throw new Error('boom');
		});

		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body).toEqual({
			error: {
				code: 'internal_error',
				message: 'Internal server error',
				details: { errorId: expect.any(String) }
			}
		});
		expect(log.error).toHaveBeenCalledWith(
			expect.objectContaining({ errorId: body.error.details.errorId, message: 'boom' }),
			'unhandled error'
		);
	});

	it('conserva el status de otros errores de kit (p. ej. 403 CSRF) con el código del catálogo', async () => {
		const original = new Response('Cross-site POST form submissions are forbidden', {
			status: 403,
			statusText: 'Forbidden'
		});

		const response = await run(eventFor('/api/v1/a', { method: 'POST' }).event, () => original);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } });
	});
});
