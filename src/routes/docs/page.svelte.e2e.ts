import { expect, test } from '@playwright/test';

// /docs (US6 #266, tarea #281) contra el stack completo: abre sin sesión (el
// guard no redirige a /login) y Scalar pinta la referencia de la spec de
// /api/v1/openapi.json con sus endpoints, sin violar la CSP de la app.

test('/docs responde 200 sin sesión', async ({ request }) => {
	const response = await request.get('/docs', { maxRedirects: 0 });
	expect(response.status()).toBe(200);
});

test('/docs muestra la referencia de Scalar de la spec de /api/v1', async ({ page }) => {
	const cspViolations: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
			cspViolations.push(message.text());
		}
	});
	const specRequest = page.waitForRequest((request) =>
		request.url().endsWith('/api/v1/openapi.json')
	);

	await page.goto('/docs');
	await expect(page).toHaveURL(/\/docs$/);

	const container = page.getByTestId('api-reference');
	await expect(container).toHaveAttribute('data-spec-url', '/api/v1/openapi.json');
	await specRequest;

	// Scalar ha montado con la spec: su título y, en la navegación lateral, los
	// endpoints de /api/v1 (summaries de `#lib/server/openapi.ts`).
	await expect(container.getByRole('heading', { name: 'y-tu-que-compras API' })).toBeVisible();
	await expect(container.getByRole('link', { name: /Crear una lista/ })).toHaveAttribute(
		'href',
		'#tag/lists/POST/families/{familyId}/lists'
	);

	expect(cspViolations).toEqual([]);
});

test('el pie enlaza a /docs', async ({ page }) => {
	await page.goto('/');
	await page.locator('footer').getByRole('link', { name: 'API' }).click();
	await expect(page).toHaveURL(/\/docs$/);
});
