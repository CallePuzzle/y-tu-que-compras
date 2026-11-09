import { expect, test } from '@playwright/test';
import { switchBackToTab } from '../../../e2e/helpers/browser';
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
	const familyA = await createFamily({ name: 'Familia A', owner: user });
	await createFamily({ name: 'Familia B', owner: user });

	await seedSession(page, user);
	await page.goto('/lists');
	await expect(page).toHaveURL(/\/families$/);

	// Una sola familia: selección automática (issue #63), la home de listas
	// funciona sin preguntar nada.
	// Sin roles antes que sin miembros: el trigger de la BD no deja quitar al
	// último admin de una familia que sigue viva (issue #104).
	await prisma.role.deleteMany({ where: { contextId: familyA.id } });
	await prisma.member.deleteMany({ where: { contextId: familyA.id } });
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
	await dialog.getByRole('radio', { name: 'Rosa' }).click();
	await dialog.getByRole('radio', { name: 'Manzana' }).click();
	await dialog.getByRole('button', { name: 'Nueva lista' }).click();

	await expect(page.getByRole('status')).toContainText('Lista creada: ya aparece en la vista.');
	const row = page.locator('li', { hasText: 'Frutería' });
	await expect(row).toBeVisible();
	await expect(row.getByText('Vacía')).toBeVisible();

	// La selección PERSISTE (regresión: el formulario no llevaba color/icono
	// en el FormData y superforms rellenaba los enums con su primera opción —
	// entonces primary + list-checks). Rosa es `pink` en la paleta dedicada;
	// el chip de la fila debe pintarlo y el editor cargarlo.
	await expect(row.locator('span').first()).toHaveClass(/bg-list-pink/);
	await row.getByRole('button', { name: 'Editar lista' }).click();
	const createDialog = page.locator('dialog[open]');
	await expect(createDialog.getByRole('radio', { name: 'Rosa' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(createDialog.getByRole('radio', { name: 'Manzana' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
});

test('editar lista reutiliza el mismo formulario con los datos cargados', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Frutería', color: 'red' });
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
	// Cambiar también el color: el guardado debe reflejarlo (mismo FormData
	// sin color/icono que en la creación, ver el test de crear).
	await dialog.getByRole('radio', { name: 'Amarillo' }).click();
	await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

	await expect(page.getByRole('status')).toContainText('Lista actualizada.');
	await expect(page.locator('li', { hasText: 'Supermercado' })).toBeVisible();
	await expect(page.locator('li', { hasText: list.name })).toHaveCount(0);
	// Amarillo es `yellow` en la paleta dedicada: el chip de la fila debe
	// cambiar a él.
	await expect(page.locator('li', { hasText: 'Supermercado' }).locator('span').first()).toHaveClass(
		/bg-list-yellow/
	);
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

test('un doble toque en «Borrar definitivamente» envía un solo POST (#115)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createList({ familyId: family.id, name: 'Frutería' });
	await seedSession(page, user);

	// La respuesta se retiene: el 2.º toque llega con la 1.ª petición en vuelo.
	let posts = 0;
	await page.route('**/lists?/delete', async (route) => {
		posts++;
		await new Promise((resolve) => setTimeout(resolve, 500));
		await route.continue();
	});

	await page.goto('/lists');
	await waitForHydration(page);

	await page.locator('li', { hasText: 'Frutería' }).getByRole('button', { name: 'Borrar' }).click();
	const confirmButton = page
		.locator('dialog[open]')
		.getByRole('button', { name: 'Borrar definitivamente' });
	await confirmButton.click({ clickCount: 2 });

	// Un único éxito y ningún «ya no existe» detrás.
	await expect(page.getByRole('status')).toContainText('Lista borrada.');
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(posts).toBe(1);
});

test('contadores de pendientes por lista', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const pending = await createList({ familyId: family.id, name: 'Pendientes' });
	await createItem({ listId: pending.id, name: 'Leche', order: 0 });
	await createItem({ listId: pending.id, name: 'Pan', order: 1 });
	const purchased = await createList({ familyId: family.id, name: 'Comprada' });
	await createItem({ listId: purchased.id, name: 'Lejía', purchased: true, order: 0 });
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
	const ownFamily = await createFamily({ name: 'Familia Mía', owner: user });
	await createList({ familyId: ownFamily.id, name: 'Lista mía' });
	const other = await createUser();
	const otherFamily = await createFamily({ name: 'Familia Ajena', owner: other });
	const otherFamilyList = await createList({ familyId: otherFamily.id, name: 'Lista ajena' });
	await seedSession(page, user);

	// La activa es la única familia del usuario (selección automática).
	await page.goto('/lists');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Lista mía' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Lista ajena' })).toHaveCount(0);

	// Y el detalle de la lista ajena, aunque se conozca el id, bota al listado.
	await page.goto(`/lists/${otherFamilyList.id}`);
	await expect(page).toHaveURL(/\/lists$/);
	await expect(page.locator('li', { hasText: 'Lista mía' })).toBeVisible();
});

test('cambiar de familia activa cambia las listas sin recargar (#64)', async ({ page }) => {
	const user = await createUser();
	const familyA = await createFamily({ name: 'Familia A', owner: user });
	const familyB = await createFamily({ name: 'Familia B', owner: user });
	await createList({ familyId: familyA.id, name: 'Compra del super' });
	await createList({ familyId: familyB.id, name: 'Ferretería' });
	await seedSession(page, user);

	// Dos familias y ninguna elegida: /families es la puerta, y ahí está el
	// selector de la cabecera para elegir.
	await page.goto('/families');
	await waitForHydration(page);

	const selector = page.getByRole('button', { name: 'Cambiar de familia' });
	await expect(selector).toContainText('Elegir familia');
	await selector.click();
	await page.getByRole('menuitemradio', { name: 'Familia A' }).click();
	await expect(selector).toContainText('Familia A');

	await page.goto('/lists');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Compra del super' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Ferretería' })).toHaveCount(0);

	// Cambio en caliente: invalidateAll repinta las listas sin navegación.
	await selector.click();
	await page.getByRole('menuitemradio', { name: 'Familia B' }).click();
	await expect(selector).toContainText('Familia B');
	await expect(page.locator('li', { hasText: 'Ferretería' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Compra del super' })).toHaveCount(0);
});

test('los selectores de color e icono son una parada de tabulador con flechas (#116)', async ({
	page
}) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);
	await page.getByRole('button', { name: 'Nueva lista' }).first().click();
	const dialog = page.locator('dialog[open]');

	const colors = dialog.getByRole('radiogroup', { name: 'Color' });
	const selected = colors.getByRole('radio', { checked: true });
	// Roving tabindex: solo la opción marcada está en el orden de tabulación.
	await expect(colors.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);
	await expect(selected).toHaveAttribute('tabindex', '0');

	// → marca la siguiente y le pasa el foco; ← vuelve.
	await selected.focus();
	const initial = await selected.getAttribute('aria-label');
	await page.keyboard.press('ArrowRight');
	const next = colors.getByRole('radio', { checked: true });
	await expect(next).not.toHaveAttribute('aria-label', initial ?? '');
	await expect(next).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(colors.getByRole('radio', { checked: true })).toHaveAttribute(
		'aria-label',
		initial ?? ''
	);
	// Fin lleva a la última opción.
	await page.keyboard.press('End');
	await expect(colors.getByRole('radio').last()).toHaveAttribute('aria-checked', 'true');
	await expect(colors.getByRole('radio').last()).toBeFocused();
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
	const newList = await createList({ familyId: family.id, name: 'Huevos' });
	// …y volvemos a la pestaña: con el modal abierto NO debe revalidar.
	await switchBackToTab(page);
	await expect(page.locator('li', { hasText: 'Huevos' })).toHaveCount(0);
	await expect(dialog.locator('input[name="name"]')).toHaveValue('Congelados');

	// Cerrado el modal, la vuelta a la pestaña sí refresca los contadores.
	await dialog.getByRole('button', { name: 'Cerrar' }).click();
	await switchBackToTab(page);
	await expect(page.locator('li', { hasText: newList.name })).toBeVisible();
});
