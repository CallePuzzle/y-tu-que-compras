import { expect, test } from '@playwright/test';
import { volverALaPestana } from '../../../e2e/helpers/browser';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import { createFamily, createPantryItem, createUser, resetDb } from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('sin familia elegida manda a /families, y con una sola la elige sola', async ({ page }) => {
	const user = await createUser();
	// Dos familias: hay decisión que tomar, así que /pantry no entra.
	const familiaA = await createFamily({ name: 'Familia A', owner: user });
	await createFamily({ name: 'Familia B', owner: user });

	await seedSession(page, user);
	await page.goto('/pantry');
	await expect(page).toHaveURL(/\/families$/);

	// Una sola familia: selección automática (issue #63), la despensa funciona
	// sin preguntar nada.
	await prisma.member.deleteMany({ where: { contextId: familiaA.id } });
	await page.goto('/pantry');
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByRole('heading', { name: 'Tu despensa' })).toBeVisible();
});

test('estado vacio con CTA hacia las listas', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);

	await expect(page.getByText(/La despensa está vacía/)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Ir a las listas' })).toBeVisible();
});

test('muestra los productos con nombre, cantidad y unidad', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		quantity: 1.5,
		unit: 'liter'
	});
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 1, unit: 'unit' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);

	const leche = page.locator('li', { hasText: 'Leche entera' });
	await expect(leche).toBeVisible();
	await expect(leche.getByText('1.5 L')).toBeVisible();
	const pan = page.locator('li', { hasText: 'Pan' });
	await expect(pan).toBeVisible();
	await expect(pan.getByText('1 ud')).toBeVisible();
});

test('los productos de otras familias no se ven', async ({ page }) => {
	const user = await createUser();
	const mia = await createFamily({ name: 'Familia Mía', owner: user });
	await createPantryItem({ familyId: mia.id, name: 'Leche entera', quantity: 1, unit: 'liter' });
	const otro = await createUser();
	const ajena = await createFamily({ name: 'Familia Ajena', owner: otro });
	await createPantryItem({ familyId: ajena.id, name: 'Caviar', quantity: 1, unit: 'unit' });
	await seedSession(page, user);

	// La activa es la única familia del usuario (selección automática).
	await page.goto('/pantry');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Leche entera' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Caviar' })).toHaveCount(0);
});

test('al volver a la pestaña se actualiza con lo comprado por otro miembro (#44)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 1, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Leche entera' })).toBeVisible();
	// El contador va acotado a la sección de contenido: el menú también pinta
	// `li` (entradas de navegación).
	await expect(page.locator('section li')).toHaveCount(1);

	// «Otro miembro» finaliza una compra mientras miramos: su comprado aterriza
	// en la despensa (lo que deja `finalizePurchase`)…
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 2, unit: 'unit' });
	// …y al volver a la pestaña la despensa se repinta sin recargar.
	await volverALaPestana(page);
	await expect(page.locator('li', { hasText: 'Pan' })).toBeVisible();
	await expect(page.locator('section li')).toHaveCount(2);
});

test('el menu de navegacion lleva a la despensa', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);
	await page.getByRole('link', { name: 'Despensa' }).first().click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByRole('heading', { name: 'Tu despensa' })).toBeVisible();
});
