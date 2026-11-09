import { expect, test } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import { createCategory, createFamily, createUser, resetDb } from '../../../e2e/helpers/seed';

// Página /categories (issue #170): gestión completa de las categorías de la
// familia desde la UI — alta, edición, borrado con confirmación y reordenar —
// sobre la capa de servidor de la #169. El proyecto chromium corre en español.

test.beforeEach(async () => {
	await resetDb();
});

test('sin familia elegida manda a /families', async ({ page }) => {
	const user = await createUser();
	// Dos familias: hay decisión que tomar, así que la vista no entra.
	await createFamily({ name: 'Familia A', owner: user });
	await createFamily({ name: 'Familia B', owner: user });

	await seedSession(page, user);
	await page.goto('/categories');
	await expect(page).toHaveURL(/\/families$/);
});

test('estado vacío con CTA de creación', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/categories');
	await waitForHydration(page);

	await expect(page.getByText(/Todavía no hay categorías/)).toBeVisible();
	// Dos paradas con el mismo CTA: la cabecera y el estado vacío.
	await expect(page.getByRole('button', { name: 'Nueva categoría' })).toHaveCount(2);
});

test('el menú lateral lleva a las categorías', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	// Entrada del menú (showInMenu de #170): desde otra vista se llega en un toque.
	await page.goto('/lists');
	await waitForHydration(page);
	await page.getByRole('link', { name: 'Categorías' }).first().click();
	await expect(page).toHaveURL(/\/categories$/);
	await expect(page.getByRole('heading', { name: 'Tus categorías' })).toBeVisible();
});

test('crear una categoría la añade al final del orden', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createCategory({ familyId: family.id, name: 'Congelados', position: 0 });
	await seedSession(page, user);

	await page.goto('/categories');
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Nueva categoría' }).first().click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="name"]').fill('Lácteos');
	await dialog.getByRole('button', { name: 'Nueva categoría' }).click();

	// El modal cierra, avisa y la categoría nueva queda al final del orden.
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Categoría creada: ya aparece en la vista.');
	const rows = page.locator('section ol > li');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText('Congelados');
	await expect(rows.nth(1)).toContainText('Lácteos');
});

test('el nombre duplicado (normalizado) se rechaza con error claro', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createCategory({ familyId: family.id, name: 'Lácteos', position: 0 });
	await seedSession(page, user);

	await page.goto('/categories');
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Nueva categoría' }).first().click();
	const dialog = page.locator('dialog[open]');
	// «lacteos» choca con «Lácteos» tras normalizar: el canónico es cosa de la
	// base (único familia+nombre normalizado, capa #169), no del formulario.
	await dialog.locator('input[name="name"]').fill('lacteos');
	await dialog.getByRole('button', { name: 'Nueva categoría' }).click();

	// El fallo se queda DENTRO del modal, abierto, con su mensaje.
	await expect(page.locator('dialog[open]')).toBeVisible();
	await expect(
		dialog.getByText('Ya existe una categoría con ese nombre en esta familia.')
	).toBeVisible();
	// Y nada se creó: la familia sigue con su única categoría.
	const categories = await prisma.category.findMany({ where: { organizationId: family.id } });
	expect(categories).toHaveLength(1);
	expect(categories[0]?.name).toBe('Lácteos');
});

test('editar renombra la categoría', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createCategory({ familyId: family.id, name: 'Lácteos', position: 0 });
	await seedSession(page, user);

	await page.goto('/categories');
	await waitForHydration(page);

	const row = page.locator('section ol > li', { hasText: 'Lácteos' });
	await row.getByRole('button', { name: 'Editar categoría' }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Editar categoría' })).toBeVisible();
	await dialog.locator('input[name="name"]').fill('Frutería');
	await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Categoría actualizada.');
	// La fila renombrada ya no pinta «Lácteos»: se busca por el nombre nuevo.
	await expect(page.locator('section ol > li', { hasText: 'Frutería' })).toBeVisible();
	await expect(page.locator('section ol > li', { hasText: 'Lácteos' })).toHaveCount(0);
	const category = await prisma.category.findFirst({ where: { organizationId: family.id } });
	expect(category).toMatchObject({ name: 'Frutería', normalizedName: 'fruteria' });
});

test('borrar pide confirmación y luego desaparece de vista y base', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createCategory({ familyId: family.id, name: 'Lácteos', position: 0 });
	await seedSession(page, user);

	await page.goto('/categories');
	await waitForHydration(page);

	const row = page.locator('section ol > li', { hasText: 'Lácteos' });
	// Primero la confirmación: escapar deja la categoría en su sitio.
	await row.getByRole('button', { name: 'Borrar', exact: true }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByText('¿Borrar «Lácteos»?')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(row).toBeVisible();

	// Confirmar borra: fuera de la vista y de la base.
	await row.getByRole('button', { name: 'Borrar', exact: true }).click();
	await page
		.locator('dialog[open]')
		.getByRole('button', { name: 'Borrar definitivamente' })
		.click();
	await expect(page.getByRole('status')).toContainText('Categoría borrada.');
	await expect(row).toHaveCount(0);
	await expect(
		prisma.category.findFirst({ where: { organizationId: family.id } })
	).resolves.toBeNull();
});

test('subir y bajar reordena, con los bordes deshabilitados, y se conserva al recargar', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createCategory({ familyId: family.id, name: 'Congelados', position: 0 });
	await createCategory({ familyId: family.id, name: 'Lácteos', position: 1 });
	await createCategory({ familyId: family.id, name: 'Frutería', position: 2 });
	await seedSession(page, user);

	await page.goto('/categories');
	await waitForHydration(page);
	const rows = page.locator('section ol > li');
	await expect(rows).toHaveCount(3);

	// Bordes: la primera no sube y la última no baja.
	await expect(
		rows.filter({ hasText: 'Congelados' }).getByRole('button', { name: 'Subir' })
	).toBeDisabled();
	await expect(
		rows.filter({ hasText: 'Frutería' }).getByRole('button', { name: 'Bajar' })
	).toBeDisabled();

	// Bajar «Congelados»: Lácteos, Congelados, Frutería.
	await rows.filter({ hasText: 'Congelados' }).getByRole('button', { name: 'Bajar' }).click();
	await expect(rows.nth(0)).toContainText('Lácteos');
	await expect(rows.nth(1)).toContainText('Congelados');
	await expect(rows.nth(2)).toContainText('Frutería');

	// Subir «Frutería»: Lácteos, Frutería, Congelados.
	await rows.filter({ hasText: 'Frutería' }).getByRole('button', { name: 'Subir' }).click();
	await expect(rows.nth(0)).toContainText('Lácteos');
	await expect(rows.nth(1)).toContainText('Frutería');
	await expect(rows.nth(2)).toContainText('Congelados');

	// El orden vive en la base (`reorderCategories`): al recargar sigue igual.
	await page.reload();
	await expect(rows.nth(0)).toContainText('Lácteos');
	await expect(rows.nth(1)).toContainText('Frutería');
	await expect(rows.nth(2)).toContainText('Congelados');
	const order = await prisma.category.findMany({
		where: { organizationId: family.id },
		orderBy: { position: 'asc' }
	});
	expect(order.map((category) => category.name)).toEqual(['Lácteos', 'Frutería', 'Congelados']);
});

test('las categorías de otras familias no se ven', async ({ page }) => {
	const user = await createUser();
	const ownFamily = await createFamily({ name: 'Familia Mía', owner: user });
	await createCategory({ familyId: ownFamily.id, name: 'Lácteos', position: 0 });
	const other = await createUser();
	const otherFamily = await createFamily({ name: 'Familia Ajena', owner: other });
	await createCategory({ familyId: otherFamily.id, name: 'Caviar', position: 0 });
	await seedSession(page, user);

	// La activa es la única familia del usuario (selección automática).
	await page.goto('/categories');
	await waitForHydration(page);
	await expect(page.locator('section ol > li', { hasText: 'Lácteos' })).toBeVisible();
	await expect(page.locator('section ol > li', { hasText: 'Caviar' })).toHaveCount(0);
});
