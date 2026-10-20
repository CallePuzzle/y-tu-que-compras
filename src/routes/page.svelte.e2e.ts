import { expect, test } from '@playwright/test';

test('sin sesion, una ruta privada redirige a /login conservando la url', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login\?redirectTo=%2F$/);

	// Una ruta profunda, con query: tras el login se debe volver a ella.
	await page.goto('/families/45?orden=asc');
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Ffamilies%2F45%3Forden%3Dasc$/);
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
