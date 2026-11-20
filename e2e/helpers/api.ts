import { expect, type Page } from '@playwright/test';
import { loadTestEnv } from './env';

/**
 * Crea un token de API REAL (plugin apiKey de better-auth) para la usuaria con
 * sesión abierta en `page` (sembrada con `seedSession` o por login OTP con
 * `loginViaUi`): el mismo endpoint que usa la página /settings/api-tokens,
 * llamado por HTTP con la cookie del contexto. Devuelve la clave en claro, lo
 * único que el plugin no guarda (en BD solo queda el hash).
 *
 * El `Origin` es obligatorio: better-auth rechaza las peticiones con cookie
 * de origen desconocido (protección CSRF), y `page.request` no lo añade solo.
 */
export async function createApiToken(page: Page, name = 'Token e2e'): Promise<string> {
	const origin = loadTestEnv().BETTER_AUTH_URL;
	const response = await page.request.post('/api/auth/api-key/create', {
		data: { name },
		headers: { origin }
	});
	expect(response.status(), await response.text()).toBe(200);
	const { key } = (await response.json()) as { key: string };
	expect(key).toEqual(expect.any(String));
	return key;
}

/** Cabecera `Authorization` de la API pública /api/v1. */
export function bearer(token: string): Record<string, string> {
	return { authorization: `Bearer ${token}` };
}
