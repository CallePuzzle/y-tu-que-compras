import { expect, test } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { createFamily, createPurchaseRecord, createUser, resetDb } from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('sin familia elegida manda a /families', async ({ page }) => {
	const user = await createUser();
	// Dos familias: hay decisión que tomar, así que /history no entra.
	await createFamily({ name: 'Familia A', owner: user });
	await createFamily({ name: 'Familia B', owner: user });

	await seedSession(page, user);
	await page.goto('/history');
	await expect(page).toHaveURL(/\/families$/);
});

test('estado vacío con CTA hacia las listas', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/history');
	await waitForHydration(page);

	await expect(page.getByText(/Todavía no hay compras/)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Ir a las listas' })).toBeVisible();
});

test('el menú de navegación lleva al historial', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);
	await page.getByRole('link', { name: 'Historial' }).first().click();
	await expect(page).toHaveURL(/\/history$/);
	await expect(page.getByRole('heading', { name: 'Historial de compras' })).toBeVisible();
});

test('muestra las compras con lista de origen, fecha y total, la más reciente primero', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra semanal',
		total: 43.2,
		createdAt: new Date('2026-10-20T18:00:00Z')
	});
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Frutería',
		total: 7.5,
		createdAt: new Date('2026-10-27T10:30:00Z')
	});
	await seedSession(page, user);

	await page.goto('/history');
	await waitForHydration(page);

	// Orden por fecha descendente (#76): la más nueva arriba.
	const filas = page.locator('section li');
	await expect(filas).toHaveCount(2);
	await expect(filas.nth(0)).toContainText('Frutería');
	await expect(filas.nth(0)).toContainText('27 oct 2026');
	await expect(filas.nth(0)).toContainText('7,50 €');
	await expect(filas.nth(1)).toContainText('Compra semanal');
	await expect(filas.nth(1)).toContainText('43,20 €');
});

test('carga incremental: «Cargar más» añade la cola sin perder las filas ya vistas', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	for (let i = 0; i < 25; i++) {
		// createdAt crecientes: la «Compra 25» es la más reciente.
		await createPurchaseRecord({
			familyId: family.id,
			listName: `Compra ${i + 1}`,
			createdAt: new Date(Date.UTC(2026, 0, 1, 12, i))
		});
	}
	await seedSession(page, user);

	await page.goto('/history');
	await waitForHydration(page);
	await expect(page.locator('section li')).toHaveCount(20);
	await expect(page.getByRole('button', { name: 'Cargar más' })).toBeVisible();
	// Página llena: la más nueva de las 25 se ve, la más vieja aún no (match
	// exacto: «Compra 1» también está en «Compra 10»… «Compra 19»).
	await expect(page.getByText('Compra 25')).toBeVisible();
	await expect(page.getByText('Compra 1', { exact: true })).toHaveCount(0);

	await page.getByRole('button', { name: 'Cargar más' }).click();
	await expect(page).toHaveURL(/\?offset=20$/);
	await expect(page.locator('section li')).toHaveCount(25);
	// Ya no queda historia detrás: el botón desaparece.
	await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
	// Lo ya visto sigue en su sitio y la cola ha aterrizado debajo.
	await expect(page.locator('section li').nth(0)).toContainText('Compra 25');
	await expect(page.getByText('Compra 1', { exact: true })).toBeVisible();
});

test('«Cargar más» no devuelve la vista al principio de la página (#117)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	for (let i = 0; i < 25; i++) {
		await createPurchaseRecord({
			familyId: family.id,
			listName: `Compra ${i + 1}`,
			createdAt: new Date(Date.UTC(2026, 0, 1, 12, i))
		});
	}
	await seedSession(page, user);

	// Viewport bajo: con 20 filas la página tiene scroll de sobra.
	await page.setViewportSize({ width: 412, height: 600 });
	await page.goto('/history');
	await waitForHydration(page);

	const boton = page.getByRole('button', { name: 'Cargar más' });
	await boton.scrollIntoViewIfNeeded();
	const antes = await page.evaluate(() => window.scrollY);
	expect(antes).toBeGreaterThan(0);

	await boton.click();
	await expect(page.locator('section li')).toHaveCount(25);
	// La vista sigue donde estaba: la cola nueva aparece debajo de ella.
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(antes);
});

test('cada compra enlaza a su detalle', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra semanal',
		total: 12.34,
		items: [
			{ name: 'Leche entera', quantity: 2, unit: 'liter' },
			{ name: 'Pan', quantity: 1, unit: 'unit' }
		]
	});
	await seedSession(page, user);

	await page.goto('/history');
	await waitForHydration(page);

	await page.locator('section li').first().getByRole('link').click();
	await expect(page).toHaveURL(/\/history\/[a-z0-9]+$/);
	await expect(page.getByRole('heading', { name: 'Compra semanal' })).toBeVisible();
	// El detalle trae los items del snapshot y el total a mano.
	await expect(page.getByText('Leche entera')).toBeVisible();
	await expect(page.getByText('2 L')).toBeVisible();
	await expect(page.getByText('12,34 €')).toBeVisible();
});

test('las compras de otras familias no se ven', async ({ page }) => {
	const user = await createUser();
	const mia = await createFamily({ name: 'Familia Mía', owner: user });
	await createPurchaseRecord({
		familyId: mia.id,
		listName: 'Compra mía',
		total: 10,
		items: [{ name: 'Leche', quantity: 1, unit: 'liter' }]
	});
	const otro = await createUser();
	const ajena = await createFamily({ name: 'Familia Ajena', owner: otro });
	await createPurchaseRecord({
		familyId: ajena.id,
		listName: 'Caviar ajeno',
		total: 99,
		items: [{ name: 'Caviar', quantity: 1, unit: 'unit' }]
	});
	await seedSession(page, user);

	await page.goto('/history');
	await waitForHydration(page);

	await expect(page.getByText('Compra mía')).toBeVisible();
	await expect(page.getByText('Caviar ajeno')).toHaveCount(0);
});
