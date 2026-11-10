import { expect, test } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import {
	createFamily,
	createPurchaseRecord,
	createStore,
	createUser,
	resetDb
} from '../../../e2e/helpers/seed';

// Página /stores (issue #183): gestión completa de los establecimientos de la
// familia desde la UI — alta, edición y borrado con confirmación — sobre la
// capa de servidor de la #182. El proyecto chromium corre en español.

test.beforeEach(async () => {
	await resetDb();
});

test('sin familia elegida manda a /families', async ({ page }) => {
	const user = await createUser();
	// Dos familias: hay decisión que tomar, así que la vista no entra.
	await createFamily({ name: 'Familia A', owner: user });
	await createFamily({ name: 'Familia B', owner: user });

	await seedSession(page, user);
	await page.goto('/stores');
	await expect(page).toHaveURL(/\/families$/);
});

test('estado vacío con CTA de creación', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/stores');
	await waitForHydration(page);

	await expect(page.getByText(/Todavía no hay establecimientos/)).toBeVisible();
	// Dos paradas con el mismo CTA: la cabecera y el estado vacío.
	await expect(page.getByRole('button', { name: 'Nuevo establecimiento' })).toHaveCount(2);
});

test('el menú lateral lleva a los establecimientos, fuera del dock móvil', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	// Entrada del menú (showInMenu de #183): desde otra vista se llega en un toque.
	await page.goto('/lists');
	await waitForHydration(page);
	await page.getByRole('link', { name: 'Establecimientos' }).first().click();
	await expect(page).toHaveURL(/\/stores$/);
	await expect(page.getByRole('heading', { name: 'Tus establecimientos' })).toBeVisible();

	// Y NO en el dock (#183): la gestión fina no es navegación de uso diario.
	const dock = page.getByRole('navigation', { name: 'Navegación inferior' });
	await expect(dock.getByRole('link', { name: 'Establecimientos' })).toHaveCount(0);
});

test('crear un establecimiento lo añade al final, por orden de creación', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createStore({ familyId: family.id, name: 'Mercadona' });
	await seedSession(page, user);

	await page.goto('/stores');
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Nuevo establecimiento' }).first().click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="name"]').fill('Carrefour');
	await dialog.getByRole('button', { name: 'Nuevo establecimiento' }).click();

	// El modal cierra, avisa y el establecimiento nuevo queda al final.
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText(
		'Establecimiento creado: ya aparece en la vista.'
	);
	const rows = page.locator('section ul > li');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText('Mercadona');
	await expect(rows.nth(1)).toContainText('Carrefour');
});

test('el nombre duplicado (normalizado) se rechaza con error claro', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createStore({ familyId: family.id, name: 'Mercadona' });
	await seedSession(page, user);

	await page.goto('/stores');
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Nuevo establecimiento' }).first().click();
	const dialog = page.locator('dialog[open]');
	// «mercadona» choca con «Mercadona» tras normalizar: el canónico es cosa de
	// la base (único familia+nombre normalizado, capa #182), no del formulario.
	await dialog.locator('input[name="name"]').fill('mercadona');
	await dialog.getByRole('button', { name: 'Nuevo establecimiento' }).click();

	// El fallo se queda DENTRO del modal, abierto, con su mensaje.
	await expect(page.locator('dialog[open]')).toBeVisible();
	await expect(
		dialog.getByText('Ya existe un establecimiento con ese nombre en esta familia.')
	).toBeVisible();
	// Y nada se creó: la familia sigue con su único establecimiento.
	const stores = await prisma.store.findMany({ where: { organizationId: family.id } });
	expect(stores).toHaveLength(1);
	expect(stores[0]?.name).toBe('Mercadona');
});

test('editar renombra el establecimiento', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createStore({ familyId: family.id, name: 'Mercadona' });
	await seedSession(page, user);

	await page.goto('/stores');
	await waitForHydration(page);

	const row = page.locator('section ul > li', { hasText: 'Mercadona' });
	await row.getByRole('button', { name: 'Editar establecimiento' }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Editar establecimiento' })).toBeVisible();
	await dialog.locator('input[name="name"]').fill('Lidl');
	await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Establecimiento actualizado.');
	// La fila renombrada ya no pinta «Mercadona»: se busca por el nombre nuevo.
	await expect(page.locator('section ul > li', { hasText: 'Lidl' })).toBeVisible();
	await expect(page.locator('section ul > li', { hasText: 'Mercadona' })).toHaveCount(0);
	const store = await prisma.store.findFirst({ where: { organizationId: family.id } });
	expect(store).toMatchObject({ name: 'Lidl', normalizedName: 'lidl' });
});

test('borrar pide confirmación y luego desaparece de vista y base', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createStore({ familyId: family.id, name: 'Mercadona' });
	await seedSession(page, user);

	await page.goto('/stores');
	await waitForHydration(page);

	const row = page.locator('section ul > li', { hasText: 'Mercadona' });
	// Primero la confirmación: escapar deja el establecimiento en su sitio.
	await row.getByRole('button', { name: 'Borrar', exact: true }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByText('¿Borrar «Mercadona»?')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(row).toBeVisible();

	// Confirmar borra: fuera de la vista y de la base.
	await row.getByRole('button', { name: 'Borrar', exact: true }).click();
	await page
		.locator('dialog[open]')
		.getByRole('button', { name: 'Borrar definitivamente' })
		.click();
	await expect(page.getByRole('status')).toContainText('Establecimiento borrado.');
	await expect(row).toHaveCount(0);
	await expect(
		prisma.store.findFirst({ where: { organizationId: family.id } })
	).resolves.toBeNull();
});

test('borrar el establecimiento conserva las compras del historial', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const store = await createStore({ familyId: family.id, name: 'Mercadona' });
	await createPurchaseRecord({
		familyId: family.id,
		storeId: store.id,
		storeName: 'Mercadona',
		total: 23.45
	});
	await seedSession(page, user);

	await page.goto('/stores');
	await waitForHydration(page);

	// La FK es `SetNull` (tarea #179) y el nombre viaja congelado en `storeName`:
	// borrar el establecimiento solo le quita la referencia a la compra.
	const row = page.locator('section ul > li', { hasText: 'Mercadona' });
	await row.getByRole('button', { name: 'Borrar', exact: true }).click();
	await page
		.locator('dialog[open]')
		.getByRole('button', { name: 'Borrar definitivamente' })
		.click();
	await expect(page.getByRole('status')).toContainText('Establecimiento borrado.');

	const purchase = await prisma.purchaseRecord.findFirst({ where: { organizationId: family.id } });
	expect(purchase).toMatchObject({ storeId: null, storeName: 'Mercadona' });
	// El total viaja como Decimal de Prisma: comparación numérica.
	expect(Number(purchase?.total)).toBe(23.45);
});

test('los establecimientos de otras familias no se ven', async ({ page }) => {
	const user = await createUser();
	const ownFamily = await createFamily({ name: 'Familia Mía', owner: user });
	await createStore({ familyId: ownFamily.id, name: 'Mercadona' });
	const other = await createUser();
	const otherFamily = await createFamily({ name: 'Familia Ajena', owner: other });
	await createStore({ familyId: otherFamily.id, name: 'Corte Inglés' });
	await seedSession(page, user);

	// La activa es la única familia del usuario (selección automática).
	await page.goto('/stores');
	await waitForHydration(page);
	await expect(page.locator('section ul > li', { hasText: 'Mercadona' })).toBeVisible();
	await expect(page.locator('section ul > li', { hasText: 'Corte Inglés' })).toHaveCount(0);
});
