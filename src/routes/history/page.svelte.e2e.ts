import { expect, test } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import {
	createFamily,
	createPurchaseRecord,
	createStore,
	createUser,
	resetDb
} from '../../../e2e/helpers/seed';

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

	// Sin establecimiento en ninguna compra: un solo bloque, al final de todo.
	await expect(page.getByRole('heading', { level: 2, name: 'Sin establecimiento' })).toBeVisible();
	// Orden por fecha descendente (#76): la más nueva arriba.
	const rows = page.locator('section li');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText('Frutería');
	await expect(rows.nth(0)).toContainText('27 oct 2026');
	await expect(rows.nth(0)).toContainText('7,50 €');
	await expect(rows.nth(1)).toContainText('Compra semanal');
	await expect(rows.nth(1)).toContainText('43,20 €');
});

test('agrupa por establecimiento: secciones por su compra más reciente y «Sin establecimiento» al final (#187)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lidl = await createStore({ familyId: family.id, name: 'Lidl' });
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra Lidl',
		storeId: lidl.id,
		storeName: 'Lidl',
		createdAt: new Date('2026-06-15T10:00:00Z')
	});
	// Compras de un establecimiento BORRADO: el nombre del snapshot agrupa
	// igual (el historial sobrevive al borrado, SetNull + storeName).
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra Mercadona nueva',
		storeName: 'Mercadona',
		createdAt: new Date('2026-06-10T10:00:00Z')
	});
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra Mercadona vieja',
		storeName: 'Mercadona',
		createdAt: new Date('2026-03-01T10:00:00Z')
	});
	// Sin establecimiento y además la compra MÁS NUEVA: su bloque va al final
	// igualmente — es bloque propio, no una sección más (#187).
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra suelta',
		createdAt: new Date('2026-07-20T10:00:00Z')
	});
	await seedSession(page, user);

	await page.goto('/history');
	await waitForHydration(page);

	// Secciones por su compra más reciente: Lidl (15 jun) sobre Mercadona
	// (10 jun, snapshot de tienda borrada) y «Sin establecimiento» al final.
	await expect(page.getByRole('heading', { level: 2 })).toHaveText([
		'Lidl',
		'Mercadona',
		'Sin establecimiento'
	]);
	// Dentro de cada sección, de la más reciente a la más antigua.
	const rows = page.locator('section li');
	await expect(rows).toHaveCount(4);
	await expect(rows.nth(0)).toContainText('Compra Lidl');
	await expect(rows.nth(1)).toContainText('Compra Mercadona nueva');
	await expect(rows.nth(2)).toContainText('Compra Mercadona vieja');
	await expect(rows.nth(3)).toContainText('Compra suelta');
});

test('«Cargar más» por sección: solo crece la suya, las otras quedan igual (#187)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const mercadona = await createStore({ familyId: family.id, name: 'Mercadona' });
	for (let i = 0; i < 25; i++) {
		// createdAt crecientes: la «Compra Mercadona 25» es la más reciente.
		await createPurchaseRecord({
			familyId: family.id,
			listName: `Compra Mercadona ${i + 1}`,
			storeId: mercadona.id,
			storeName: 'Mercadona',
			createdAt: new Date(Date.UTC(2026, 0, 1, 12, i))
		});
	}
	const lidl = await createStore({ familyId: family.id, name: 'Lidl' });
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra Lidl',
		storeId: lidl.id,
		storeName: 'Lidl',
		createdAt: new Date('2026-02-01T10:00:00Z')
	});
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra suelta',
		createdAt: new Date('2026-01-01T10:00:00Z')
	});
	await seedSession(page, user);

	await page.goto('/history');
	await waitForHydration(page);

	// Mercadona (sección paginada) + Lidl y «Sin establecimiento» completos.
	const mercadonaLi = page.locator('li', { hasText: 'Compra Mercadona' });
	await expect(mercadonaLi).toHaveCount(20);
	await expect(page.locator('li', { hasText: 'Compra Lidl' })).toHaveCount(1);
	await expect(page.locator('li', { hasText: 'Compra suelta' })).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(1);

	await page.getByRole('button', { name: 'Cargar más' }).click();
	// Solo la sección de Mercadona crece hasta el final; las otras no se
	// mueven y, sin historia detrás en ninguna, el botón desaparece.
	await expect(page).toHaveURL(/offset-/);
	await expect(mercadonaLi).toHaveCount(25);
	await expect(page.locator('li', { hasText: 'Compra Lidl' })).toHaveCount(1);
	await expect(page.locator('li', { hasText: 'Compra suelta' })).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
});

test('dos secciones paginadas: cargar una no reinicia la página de la otra (#187)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const mercadona = await createStore({ familyId: family.id, name: 'Mercadona' });
	const lidl = await createStore({ familyId: family.id, name: 'Lidl' });
	for (let i = 0; i < 25; i++) {
		// Mercadona con las compras más nuevas: su sección queda primera.
		await createPurchaseRecord({
			familyId: family.id,
			listName: `Compra Mercadona ${i + 1}`,
			storeId: mercadona.id,
			storeName: 'Mercadona',
			createdAt: new Date(Date.UTC(2026, 5, 1, 12, i))
		});
		await createPurchaseRecord({
			familyId: family.id,
			listName: `Compra Lidl ${i + 1}`,
			storeId: lidl.id,
			storeName: 'Lidl',
			createdAt: new Date(Date.UTC(2026, 0, 1, 12, i))
		});
	}
	await seedSession(page, user);

	await page.goto('/history');
	await waitForHydration(page);

	// Dos secciones paginadas, dos botones: primero el de Mercadona (arriba).
	const mercadonaLi = page.locator('li', { hasText: 'Compra Mercadona' });
	const lidlLi = page.locator('li', { hasText: 'Compra Lidl' });
	await expect(mercadonaLi).toHaveCount(20);
	await expect(lidlLi).toHaveCount(20);
	await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(2);

	await page.getByRole('button', { name: 'Cargar más' }).first().click();
	await expect(mercadonaLi).toHaveCount(25);

	// Queda el de Lidl. Sus inputs ocultos viajan con el offset de Mercadona:
	// al cargar Lidl, Mercadona NO vuelve a la primera página (20 filas).
	await page.getByRole('button', { name: 'Cargar más' }).click();
	await expect(lidlLi).toHaveCount(25);
	await expect(mercadonaLi).toHaveCount(25);
	await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
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
	await expect(page).toHaveURL(/\?offset-none=20$/);
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

	const button = page.getByRole('button', { name: 'Cargar más' });
	await button.scrollIntoViewIfNeeded();
	const antes = await page.evaluate(() => window.scrollY);
	expect(antes).toBeGreaterThan(0);

	await button.click();
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
	const ownFamily = await createFamily({ name: 'Familia Mía', owner: user });
	await createPurchaseRecord({
		familyId: ownFamily.id,
		listName: 'Compra mía',
		total: 10,
		items: [{ name: 'Leche', quantity: 1, unit: 'liter' }]
	});
	const other = await createUser();
	const otherFamily = await createFamily({ name: 'Familia Ajena', owner: other });
	await createPurchaseRecord({
		familyId: otherFamily.id,
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
