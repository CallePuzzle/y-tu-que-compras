import { expect, test } from '@playwright/test';
import { volverALaPestana } from '../../../e2e/helpers/browser';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import {
	createFamily,
	createItem,
	createList,
	createPantryItem,
	createUser,
	resetDb
} from '../../../e2e/helpers/seed';

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

test('consumir quita el paso y al llegar a 0 el producto baja a Agotados (#73)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 2, unit: 'unit' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const pan = page.locator('li', { hasText: 'Pan' });

	// Dos consumos de 1 ud: 2 → 1 → 0.
	await pan.getByRole('button', { name: 'Consumir 1 ud' }).click();
	await expect(pan.getByText('1 ud')).toBeVisible();
	await pan.getByRole('button', { name: 'Consumir 1 ud' }).click();

	// Agotado NO es borrado: la fila baja a la sección «Agotados», atenuada,
	// sin botón de consumir (de 0 no se consume) y con el re-añadir a punto.
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();
	await expect(pan.getByText('0 ud')).toBeVisible();
	await expect(pan.getByRole('button', { name: 'Consumir 1 ud' })).toHaveCount(0);
	await expect(pan.getByRole('button', { name: 'Re-añadir a la compra' })).toBeVisible();

	// Y devolver un paso lo reponer: vuelve a «En casa» sin cabeceras que sobren.
	await pan.getByRole('button', { name: 'Devolver 1 ud' }).click();
	await expect(pan.getByText('1 ud')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Agotados' })).toHaveCount(0);
});

test('los kilos bajan a cuartos hasta agotarse (#73)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		quantity: 0.5,
		unit: 'kilogram'
	});
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });

	await leche.getByRole('button', { name: 'Consumir 0.25 kg' }).click();
	await expect(leche.getByText('0.25 kg')).toBeVisible();
	await leche.getByRole('button', { name: 'Consumir 0.25 kg' }).click();
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();
	await expect(leche.getByText('0 kg')).toBeVisible();
});

test('devolver (+) repone el paso consumido por error (#73)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Cerveza', quantity: 1, unit: 'unit' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const cerveza = page.locator('li', { hasText: 'Cerveza' });

	await cerveza.getByRole('button', { name: 'Devolver 1 ud' }).click();
	await expect(cerveza.getByText('2 ud')).toBeVisible();
});

test('re-añade a la lista que elijas y la despensa queda igual por defecto (#74)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const listaA = await createList({ familyId: family.id, name: 'Super' });
	const listaB = await createList({ familyId: family.id, name: 'Mercado' });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });
	await leche.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Re-añadir «Leche entera»' })).toBeVisible();
	// La cantidad por defecto para la lista es la que hay en despensa.
	await expect(dialog.locator('#readd-quantity')).toHaveValue('2');
	// El destino puede ser cualquiera: se elige la SEGUNDA lista.
	await dialog.locator('#readd-list').selectOption({ label: 'Mercado' });
	await dialog.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	// El modal cierra, avisa y la despensa sigue igual (leave as is por defecto).
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Añadido a la lista de la compra.');
	await expect(leche.getByText('2 L')).toBeVisible();

	// El item está en la lista elegida y no en la otra.
	await page.goto(`/lists/${listaB.id}`);
	await expect(
		page.locator('section li', { hasText: 'Leche entera' }).getByText('2 L')
	).toBeVisible();
	await page.goto(`/lists/${listaA.id}`);
	await expect(page.locator('section li', { hasText: 'Leche entera' })).toHaveCount(0);
});

test('re-añadir quitando el producto de la despensa lo saca de ella (#74)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });
	await leche.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	const dialog = page.locator('dialog[open]');
	await dialog.getByRole('radio', { name: 'Quitar de la despensa' }).check();
	await dialog.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	await expect(page.getByRole('status')).toContainText('Añadido a la lista de la compra.');
	// La despensa queda vacía…
	await expect(page.getByText(/La despensa está vacía/)).toBeVisible();
	// …y el producto está en la lista con su cantidad.
	await page.goto(`/lists/${lista.id}`);
	await expect(
		page.locator('section li', { hasText: 'Leche entera' }).getByText('2 L')
	).toBeVisible();
});

test('re-añadir suma sobre el pendiente equivalente de la lista (#74)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: lista.id, name: 'leche entera', quantity: 0.5, unit: 'liter' });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });
	await leche.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	const dialog = page.locator('dialog[open]');
	// Cantidad para la lista distinta a la de despensa: 1 L.
	await dialog.locator('#readd-quantity').fill('1');
	await dialog.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	await expect(page.getByRole('status')).toContainText('Añadido a la lista de la compra.');
	// 0,5 + 1 = 1,5 sobre UNA fila (sin duplicado), conservando el nombre escrito.
	await page.goto(`/lists/${lista.id}`);
	await expect(
		page.locator('section li', { hasText: 'leche entera' }).getByText('1.5 L')
	).toBeVisible();
	await expect(page.locator('section li')).toHaveCount(1);
});

test('sin listas el modal explica que hay que crear una (#74)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	await page
		.locator('li', { hasText: 'Leche entera' })
		.getByRole('button', { name: 'Re-añadir a la compra' })
		.click();

	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByText(/Esta familia no tiene listas/)).toBeVisible();
	// Sin listas no hay formulario que enviar.
	await expect(dialog.getByRole('button', { name: 'Re-añadir a la compra' })).toHaveCount(0);
});

test('un agotado se re-añade a la compra y se queda en la despensa a cero (#74)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 1, unit: 'unit' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const pan = page.locator('li', { hasText: 'Pan' });

	// Lo consumo hasta agotarlo…
	await pan.getByRole('button', { name: 'Consumir 1 ud' }).click();
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();

	// …y desde agotado lo mando a la lista: es la memoria de la compra.
	await pan.getByRole('button', { name: 'Re-añadir a la compra' }).click();
	const dialog = page.locator('dialog[open]');
	// El cero no puede ser la cantidad a comprar: se propone 1 paso.
	await expect(dialog.locator('#readd-quantity')).toHaveValue('1');
	await dialog.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	await expect(page.getByRole('status')).toContainText('Añadido a la lista de la compra.');
	// El agotado sigue en la despensa…
	await expect(pan.getByText('0 ud')).toBeVisible();
	// …y el item espera en la lista.
	await page.goto(`/lists/${lista.id}`);
	await expect(page.locator('section li', { hasText: 'Pan' }).getByText('1 ud')).toBeVisible();
});
