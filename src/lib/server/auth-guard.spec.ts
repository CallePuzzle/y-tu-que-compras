import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

import { handleAuthGuard, isPublicPathname } from './auth-guard.js';

// Stub mínimo de `RequestEvent`: al guard sólo le interesan `url` y `locals`.
function eventOf(pathname: string, user?: { id: string }): RequestEvent {
	return {
		url: new URL(`http://localhost${pathname}`),
		locals: { user }
	} as unknown as RequestEvent;
}

describe('isPublicPathname', () => {
	it('el login y la API de better-auth son públicos', () => {
		expect(isPublicPathname('/login')).toBe(true);
		expect(isPublicPathname('/login/')).toBe(true);
		// El router en cliente pide los datos del load a `/login/__data.json`.
		expect(isPublicPathname('/login/__data.json')).toBe(true);
		expect(isPublicPathname('/api/auth/sign-in-email')).toBe(true);
		expect(isPublicPathname('/api/auth/sign-out')).toBe(true);
	});

	it('la vista de invitación por token es pública (issue #61)', () => {
		// El token del enlace es la credencial: hay que poder ver la invitación
		// (o su caducidad) antes de crearse una cuenta. Responderla exige
		// sesión, y eso lo aplica la propia página.
		expect(isPublicPathname('/invitations/tok-1')).toBe(true);
		expect(isPublicPathname('/invitations/tok-1/__data.json')).toBe(true);
		// El índice `/invitations` (sin token) no existe: exigir sesión es lo
		// conservador.
		expect(isPublicPathname('/invitations')).toBe(false);
	});

	it('el resto de rutas exigen sesión', () => {
		expect(isPublicPathname('/')).toBe(false);
		expect(isPublicPathname('/loginfoo')).toBe(false);
		expect(isPublicPathname('/families')).toBe(false);
		expect(isPublicPathname('/api/otra-cosa')).toBe(false);
	});
});

describe('handleAuthGuard', () => {
	it('sin sesión redirige a /login conservando path y query, sin resolver', async () => {
		const event = eventOf('/families/45?orden=asc');
		const resolve = vi.fn(async () => new Response('ok'));

		// `redirect()` lanza un `Redirect` de SvelteKit; lo capturamos a mano.
		let thrown: { status?: number; location?: string } | undefined;
		try {
			await handleAuthGuard({ event, resolve });
		} catch (error) {
			thrown = error as { status?: number; location?: string };
		}

		expect(resolve).not.toHaveBeenCalled();
		expect(thrown?.status).toBe(302);
		expect(thrown?.location).toBe('/login?redirectTo=%2Ffamilies%2F45%3Forden%3Dasc');
	});

	it('con sesión resuelve la petición', async () => {
		const event = eventOf('/', { id: 'u1' });
		const resolve = vi.fn(async () => new Response('ok'));

		const response = await handleAuthGuard({ event, resolve });

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(await response.text()).toBe('ok');
	});

	it('los assets no exigen sesión (el handle de auth tampoco la resuelve)', async () => {
		const event = eventOf('/_app/immutable/entry/start.abc.js');
		const resolve = vi.fn(async () => new Response('js'));

		await handleAuthGuard({ event, resolve });

		expect(resolve).toHaveBeenCalledTimes(1);
	});
});
