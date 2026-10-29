import { expect, test } from '@playwright/test';
import { seedSession } from '../../e2e/helpers/auth';
import { createUser, resetDb } from '../../e2e/helpers/seed';

test('sin sesion, una ruta privada redirige a /login conservando la url', async ({ page }) => {
	// `/lists` y no `/`: la portada es la landing pública (#133), ya no redirige.
	await page.goto('/lists');
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Flists$/);

	// Una ruta profunda, con query: tras el login se debe volver a ella.
	await page.goto('/families/45?orden=asc');
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Ffamilies%2F45%3Forden%3Dasc$/);
});

test('sin sesion, la portada muestra la landing publica (#133)', async ({ page }) => {
	await page.goto('/');

	// Sin redirección: la landing completa se pinta en la propia portada.
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('heading', { level: 1, name: '¿Y tú qué compras?' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Cómo funciona' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Todo lo que puedes hacer' })).toBeVisible();

	// El CTA (el del hero; el de cierre repite destino) manda a acceder.
	const cta = page.getByRole('main').getByRole('link', { name: 'Acceder' }).first();
	await expect(cta).toBeVisible();
	await expect(cta).toHaveAttribute('href', '/login');
});

test('con sesion, la portada es la misma landing y el CTA lleva a las listas (#133)', async ({
	page
}) => {
	await resetDb();
	const user = await createUser();
	await seedSession(page, user);

	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: '¿Y tú qué compras?' })).toBeVisible();

	// No se le redirige: la landing cambia sólo el CTA, a las listas.
	const cta = page.getByRole('main').getByRole('link', { name: 'Ir a las listas' }).first();
	await expect(cta).toBeVisible();
	await expect(cta).toHaveAttribute('href', '/lists');
});

test('la CSP no bloquea nada y llegan las cabeceras de seguridad', async ({ page }) => {
	// `/login` es pública: la respuesta no depende del guard.
	const violations: string[] = [];
	page.on('console', (message) => {
		if (message.text().includes('Content Security Policy')) violations.push(message.text());
	});

	const response = await page.goto('/login');
	await page.waitForLoadState('networkidle');

	expect(violations).toEqual([]);
	const headers = response?.headers() ?? {};
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
	expect(headers['x-content-type-options']).toBe('nosniff');
});

test('un 404 sale traducido y dentro del layout de la app (#118)', async ({ page }) => {
	await resetDb();
	const user = await createUser();
	await seedSession(page, user);

	const response = await page.goto('/no-existe');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { name: 'Error 404' })).toBeVisible();
	await expect(page.getByText('Esta página no existe o ya no está disponible.')).toBeVisible();
	// Con el layout: la navegación de la app sigue a mano.
	await expect(page.getByRole('link', { name: 'Listas' }).first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Volver al inicio' })).toBeVisible();
});
