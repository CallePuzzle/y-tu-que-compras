import { expect, test } from '@playwright/test';
import { bearer } from '../../../../e2e/helpers/api';
import { loginViaUi, waitForHydration } from '../../../../e2e/helpers/auth';
import { createFamily, createList, createUser, resetDb } from '../../../../e2e/helpers/seed';

// Ciclo de vida completo de un token de API (US5 #265, tarea #280): el
// recorrido de punta a punta que amarra la página de ajustes (US1) con la API
// (US2). Login OTP real, token creado DESDE LA UI copiando la clave que se
// muestra una sola vez, uso contra /api/v1 y revocación desde la UI hasta que
// la API deja de aceptarlo. Los detalles de cada pieza (validación del
// formulario, confirmación al revocar, shape de las ListView, errores 403/404)
// los fijan los specs de la página y de cada ruta; aquí solo el hilo.
//
// Las llamadas a la API van con el fixture `request` (sin cookies): la única
// credencial es el Bearer. En dev better-auth no activa su rate limit global y
// el de la clave (60/min, #271) queda lejos con dos peticiones.

const UNAUTHORIZED = { error: { code: 'unauthenticated', message: 'Missing or invalid API key' } };

test.beforeEach(async () => {
	await resetDb();
});

test('token creado por la UI funciona en la API y, revocado por la UI, deja de autenticar', async ({
	page,
	request
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Semanal' });
	const listsUrl = `/api/v1/families/${family.id}/lists`;

	// 1. Sesión real y alta del token por la página de ajustes.
	await loginViaUi(page, user.email);
	await page.goto('/settings/api-tokens');
	await waitForHydration(page);
	await page.getByRole('button', { name: 'Crear token' }).first().click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="name"]').fill('Flujo completo');
	await dialog.getByRole('button', { name: 'Crear token' }).click();

	// La clave se lee del aviso que la muestra UNA vez: es lo que copiaría la
	// usuaria, no un valor sacado por otro canal.
	const revealed = page.getByRole('status');
	await expect(revealed).toContainText('es la única vez que lo verás');
	const token = ((await revealed.locator('code').textContent()) ?? '').trim();
	expect(token.length).toBeGreaterThan(32);
	await page.getByRole('link', { name: 'Ya lo he guardado' }).click();
	await expect(page.getByText(token)).toHaveCount(0);

	// Extra: el prefijo visible en el listado es el comienzo del token creado.
	const row = page.locator('section ol > li', { hasText: 'Flujo completo' });
	await expect(row).toBeVisible();
	const shownPrefix = ((await row.locator('code').textContent()) ?? '').replace(/…$/, '');
	expect(shownPrefix.length).toBeGreaterThan(0);
	expect(token.startsWith(shownPrefix)).toBe(true);

	// 2. El token recién creado autentica contra la API.
	const ok = await request.get(listsUrl, { headers: bearer(token) });
	expect(ok.status(), await ok.text()).toBe(200);
	expect(await ok.json()).toEqual([expect.objectContaining({ id: list.id, name: 'Semanal' })]);

	// El uso queda reflejado en el listado (ya no «Nunca usado»).
	// Hay que esperar a la hidratación: el botón de revocar abre la modal por JS.
	await page.reload();
	await waitForHydration(page);
	await expect(row).not.toContainText('Nunca usado');

	// 3. Revocación por la UI.
	await row.getByRole('button', { name: 'Revocar token' }).click();
	await page
		.locator('dialog[open]')
		.getByRole('button', { name: 'Revocar definitivamente' })
		.click();
	await expect(page.getByRole('status')).toContainText('Token revocado');
	await expect(row).toHaveCount(0);

	// 4. El mismo token ya no autentica: 401 con el envelope de errores.
	const revoked = await request.get(listsUrl, { headers: bearer(token) });
	expect(revoked.status()).toBe(401);
	expect(revoked.headers()['content-type']).toBe('application/json; charset=utf-8');
	expect(await revoked.json()).toEqual(UNAUTHORIZED);
});
