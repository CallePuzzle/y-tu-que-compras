import { expect, test } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../../e2e/helpers/auth';
import {
	createFamily,
	createPurchaseRecord,
	createUser,
	resetDb
} from '../../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('muestra el detalle con lista de origen, fecha, total e items del snapshot', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const compra = await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra semanal',
		total: 12.34,
		createdAt: new Date('2026-10-28T18:45:00Z'),
		items: [
			{ name: 'Leche entera', quantity: 2, unit: 'liter' },
			{ name: 'Pan de molde', quantity: 1, unit: 'unit' },
			{ name: 'Tomates', quantity: 0.75, unit: 'kilogram' }
		]
	});
	await seedSession(page, user);

	await page.goto(`/history/${compra.id}`);
	await waitForHydration(page);

	await expect(page.getByRole('heading', { name: 'Compra semanal', level: 1 })).toBeVisible();
	// La fecha formateada con la locale activa (es por defecto en e2e); la
	// hora es la de Madrid (28 oct ya va en horario de invierno: 18:45 UTC
	// → 19:45 CET).
	await expect(page.getByText('28 oct 2026')).toBeVisible();
	await expect(page.getByText('19:45')).toBeVisible();

	// El total introducido a mano (#70), tal cual se cerró la compra.
	await expect(page.getByText('12,34 €')).toBeVisible();

	// Los items congelados del momento: nombre, cantidad y unidad.
	const leche = page.locator('li', { hasText: 'Leche entera' });
	await expect(leche).toContainText('2 L');
	const pan = page.locator('li', { hasText: 'Pan de molde' });
	await expect(pan).toContainText('1 ud');
	const tomates = page.locator('li', { hasText: 'Tomates' });
	// La cantidad va cruda (como en la despensa): la issue #76 localiza fecha
	// y moneda, no las cantidades.
	await expect(tomates).toContainText('0.75 kg');
});

test('el enlace de vuelta vuelve al listado', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const compra = await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra semanal',
		total: 5
	});
	await seedSession(page, user);

	await page.goto(`/history/${compra.id}`);
	await waitForHydration(page);
	await page.getByRole('link', { name: 'Atrás' }).click();
	await expect(page).toHaveURL(/\/history$/);
});

test('una compra ajena o inexistente manda de vuelta al listado', async ({ page }) => {
	const user = await createUser();
	await createFamily({ name: 'Familia Mía', owner: user });
	const otro = await createUser();
	const ajena = await createFamily({ name: 'Familia Ajena', owner: otro });
	const compra = await createPurchaseRecord({
		familyId: ajena.id,
		listName: 'Caviar ajeno',
		total: 99
	});
	await seedSession(page, user);

	await page.goto(`/history/${compra.id}`);
	await expect(page).toHaveURL(/\/history$/);
	await expect(page.getByText('Caviar ajeno')).toHaveCount(0);

	// Un id inventado: mismo destino, sin revelar si vivió en otra parte.
	await page.goto('/history/no-existe');
	await expect(page).toHaveURL(/\/history$/);
});
