import { expect, test } from '@playwright/test';
import { volverALaPestana } from '../../../e2e/helpers/browser';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import {
	createFamily,
	createItem,
	createList,
	createUser,
	resetDb
} from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('sin familia elegida manda a /families, y con una sola la elige sola', async ({ page }) => {
	const user = await createUser();
	// Dos familias: hay decisión que tomar, así que /lists no entra.
	const familiaA = await createFamily({ name: 'Familia A', owner: user });
	await createFamily({ name: 'Familia B', owner: user });

	await seedSession(page, user);
	await page.goto('/lists');
	await expect(page).toHaveURL(/\/families$/);

	// Una sola familia: selección automática (issue #63), la home de listas
	// funciona sin preguntar nada.
	await prisma.member.deleteMany({ where: { contextId: familiaA.id } });
	await page.goto('/lists');
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/lists$/);
	await expect(page.getByRole('heading', { name: 'Tus listas' })).toBeVisible();
});

test('estado vacio con CTA para crear la primera', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	await expect(page.getByText(/Todavía no hay listas en esta familia/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Nueva lista' })).toHaveCount(2); // cabecera + CTA
});

test('crear lista por UI: color e icono del catálogo y contador a cero', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Nueva lista' }).first().click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="name"]').fill('Frutería');

	// Los selectores propios (#66): paleta de colores y catálogo de iconos.
	await dialog.getByRole('radio', { name: 'secondary' }).click();
	await dialog.getByRole('radio', { name: 'shopping-cart' }).click();
	await dialog.getByRole('button', { name: 'Nueva lista' }).click();

	await expect(page.getByRole('status')).toContainText('Lista creada: ya aparece en la vista.');
	const fila = page.locator('li', { hasText: 'Frutería' });
	await expect(fila).toBeVisible();
	await expect(fila.getByText('Vacía')).toBeVisible();
});

test('editar lista reutiliza el mismo formulario con los datos cargados', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Frutería', color: 'primary' });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	await page
		.locator('li', { hasText: 'Frutería' })
		.getByRole('button', { name: 'Editar lista' })
		.click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Editar lista' })).toBeVisible();
	await expect(dialog.locator('input[name="name"]')).toHaveValue('Frutería');

	await dialog.locator('input[name="name"]').fill('Supermercado');
	await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

	await expect(page.getByRole('status')).toContainText('Lista actualizada.');
	await expect(page.locator('li', { hasText: 'Supermercado' })).toBeVisible();
	await expect(page.locator('li', { hasText: lista.name })).toHaveCount(0);
});

test('borrar lista con confirmacion', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createList({ familyId: family.id, name: 'Frutería' });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	await page.locator('li', { hasText: 'Frutería' }).getByRole('button', { name: 'Borrar' }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: '¿Borrar «Frutería»?' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Borrar definitivamente' }).click();

	await expect(page.getByRole('status')).toContainText('Lista borrada.');
	await expect(page.locator('li', { hasText: 'Frutería' })).toHaveCount(0);
});

test('contadores de pendientes por lista', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const pendientes = await createList({ familyId: family.id, name: 'Pendientes' });
	await createItem({ listId: pendientes.id, name: 'Leche', order: 0 });
	await createItem({ listId: pendientes.id, name: 'Pan', order: 1 });
	const comprada = await createList({ familyId: family.id, name: 'Comprada' });
	await createItem({ listId: comprada.id, name: 'Lejía', purchased: true, order: 0 });
	await createList({ familyId: family.id, name: 'Limpieza' });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	await expect(
		page.locator('li', { hasText: 'Pendientes' }).getByText('Pendientes: 2')
	).toBeVisible();
	await expect(
		page.locator('li', { hasText: 'Comprada' }).getByText('Todo comprado')
	).toBeVisible();
	await expect(
		page.locator('li', { hasText: 'Limpieza' }).getByText('Vacía', { exact: true })
	).toBeVisible();
});

test('las listas de otras familias no se ven ni se dejan tocar', async ({ page }) => {
	const user = await createUser();
	const mia = await createFamily({ name: 'Familia Mía', owner: user });
	await createList({ familyId: mia.id, name: 'Lista mía' });
	const otro = await createUser();
	const ajena = await createFamily({ name: 'Familia Ajena', owner: otro });
	const listaAjena = await createList({ familyId: ajena.id, name: 'Lista ajena' });
	await seedSession(page, user);

	// La activa es la única familia del usuario (selección automática).
	await page.goto('/lists');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Lista mía' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Lista ajena' })).toHaveCount(0);

	// Y el detalle de la lista ajena, aunque se conozca el id, bota al listado.
	await page.goto(`/lists/${listaAjena.id}`);
	await expect(page).toHaveURL(/\/lists$/);
	await expect(page.locator('li', { hasText: 'Lista mía' })).toBeVisible();
});

test('cambiar de familia activa cambia las listas sin recargar (#64)', async ({ page }) => {
	const user = await createUser();
	const familiaA = await createFamily({ name: 'Familia A', owner: user });
	const familiaB = await createFamily({ name: 'Familia B', owner: user });
	await createList({ familyId: familiaA.id, name: 'Compra del super' });
	await createList({ familyId: familiaB.id, name: 'Ferretería' });
	await seedSession(page, user);

	// Dos familias y ninguna elegida: /families es la puerta, y ahí está el
	// selector de la cabecera para elegir.
	await page.goto('/families');
	await waitForHydration(page);

	const selector = page.getByRole('button', { name: 'Cambiar de familia' });
	await expect(selector).toContainText('Elegir familia');
	await selector.click();
	await page.getByRole('button', { name: 'Familia A' }).click();
	await expect(selector).toContainText('Familia A');

	await page.goto('/lists');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Compra del super' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Ferretería' })).toHaveCount(0);

	// Cambio en caliente: invalidateAll repinta las listas sin navegación.
	await selector.click();
	await page.getByRole('button', { name: 'Familia B' }).click();
	await expect(selector).toContainText('Familia B');
	await expect(page.locator('li', { hasText: 'Ferretería' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Compra del super' })).toHaveCount(0);
});

test('al volver a la pestaña con el modal abierto NO refresca (no machaca el formulario)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createList({ familyId: family.id, name: 'Frutería' });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	// Modal de creación con algo escrito: el refresco al volver lo machacaría.
	await page.getByRole('button', { name: 'Nueva lista' }).first().click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="name"]').fill('Congelados');

	// «Otro miembro» crea una lista mientras tanto…
	const nueva = await createList({ familyId: family.id, name: 'Huevos' });
	// …y volvemos a la pestaña: con el modal abierto NO debe revalidar.
	await volverALaPestana(page);
	await expect(page.locator('li', { hasText: 'Huevos' })).toHaveCount(0);
	await expect(dialog.locator('input[name="name"]')).toHaveValue('Congelados');

	// Cerrado el modal, la vuelta a la pestaña sí refresca los contadores.
	await dialog.getByRole('button', { name: 'Cerrar' }).click();
	await volverALaPestana(page);
	await expect(page.locator('li', { hasText: nueva.name })).toBeVisible();
});
