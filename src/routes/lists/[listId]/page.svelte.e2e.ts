import { expect, test } from '@playwright/test';
import { volverALaPestana } from '../../../../e2e/helpers/browser';
import { seedSession, waitForHydration } from '../../../../e2e/helpers/auth';
import { prisma } from '../../../../e2e/helpers/db';
import {
	createFamily,
	createItem,
	createList,
	createUser,
	resetDb
} from '../../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('el detalle muestra la lista y su alta rápida; items en orden', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({
		familyId: family.id,
		name: 'Frutería',
		color: 'secondary',
		icon: 'shopping-cart'
	});
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	await expect(page.getByRole('heading', { name: 'Frutería' })).toBeVisible();
	await expect(page.getByText(/Esta lista está vacía/)).toBeVisible();

	// Alta rápida (checklist #68): nombre, cantidad y unidad en la misma vista.
	// (.first(): mientras hay estado vacío, el CTA repite «Añadir».)
	await page.locator('#add-name').fill('Leche entera');
	await page.getByRole('button', { name: 'Añadir' }).first().click();

	const leche = page.locator('li', { hasText: 'Leche entera' });
	await expect(leche).toBeVisible();
	await expect(leche.getByText('1 ud')).toBeVisible();

	// El formulario queda vacío para encadenar otra alta (invalidateAll
	// pesimista): se añade un segundo item sin recargar nada.
	await expect(page.locator('#add-name')).toHaveValue('');
	await page.locator('#add-name').fill('Plátanos');
	await page.locator('#add-quantity').fill('2');
	await page.locator('#add-unit').selectOption('kilogram');
	await page.getByRole('button', { name: 'Añadir' }).click();

	await expect(page.locator('li', { hasText: 'Plátanos' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Plátanos' }).getByText('2 kg')).toBeVisible();
	// El orden de inserción se mantiene en pendientes.
	await expect(page.locator('ol > li').first()).toContainText('Leche entera');
});

test('la validacion de cantidad corta el alta en cliente', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Frutería' });
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	await page.locator('#add-name').fill('Nada');
	await page.locator('#add-quantity').fill('0');
	await page.getByRole('button', { name: 'Añadir' }).first().click();

	// Error del schema junto al campo, y el item no llega al servidor.
	await expect(page.getByText('La cantidad debe ser un número mayor que cero.')).toBeVisible();
	await expect(page.locator('li', { hasText: 'Nada' })).toHaveCount(0);
});

test('editar item en el modal con sus datos cargados', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Frutería' });
	const item = await createItem({ listId: lista.id, name: 'Leche entera', quantity: 1 });
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	await page
		.locator('li', { hasText: 'Leche entera' })
		.getByRole('button', { name: 'Editar item' })
		.click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Editar item' })).toBeVisible();
	await expect(dialog.locator('#edit-name')).toHaveValue('Leche entera');

	await dialog.locator('#edit-name').fill('Leche desnatada');
	await dialog.locator('#edit-quantity').fill('3');
	await dialog.locator('#edit-unit').selectOption('liter');
	await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

	await expect(page.getByRole('status')).toContainText('Item actualizado.');
	const fila = page.locator('li', { hasText: 'Leche desnatada' });
	await expect(fila).toBeVisible();
	await expect(fila.getByText('3 L')).toBeVisible();

	const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
	expect(updated.name).toBe('Leche desnatada');
});

test('borrar item con confirmacion', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Frutería' });
	const item = await createItem({ listId: lista.id, name: 'Leche entera' });
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	await page
		.locator('li', { hasText: 'Leche entera' })
		.getByRole('button', { name: 'Borrar' })
		.click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: '¿Borrar «Leche entera»?' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Borrar definitivamente' }).click();

	await expect(page.getByRole('status')).toContainText('Item borrado.');
	await expect(page.locator('li', { hasText: 'Leche entera' })).toHaveCount(0);
	await expect(prisma.item.findUnique({ where: { id: item.id } })).resolves.toBeNull();
});

test('marcar comprado: se tacha, baja a Comprados y el servidor lo guarda', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: lista.id, name: 'Leche', order: 0 });
	await createItem({ listId: lista.id, name: 'Pan', order: 1 });
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	// Sin comprados no hay cabecera de secciones todavía.
	await expect(page.getByRole('heading', { name: 'Comprados' })).toHaveCount(0);

	await page.getByRole('checkbox', { name: 'Marcar como comprado' }).first().click();
	// El éxito trae el load: el item queda tachado (y atenuada su fila) en su
	// sección, y el checkbox pasa a ofrecer desmarcar.
	const leche = page.locator('li', { hasText: 'Leche' });
	await expect(leche).toHaveClass(/opacity-60/);
	await expect(leche.locator('p').first()).toHaveClass(/line-through/);
	await expect(leche.getByRole('checkbox', { name: 'Marcar como pendiente' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Comprados' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Pendientes' })).toBeVisible();

	// La verdad quedó en el servidor (checklist #69): el toggle persiste.
	const items = await prisma.item.findMany({ where: { listId: lista.id } });
	expect(items.find((row) => row.name === 'Leche')?.purchased).toBe(true);
	expect(items.find((row) => row.name === 'Pan')?.purchased).toBe(false);

	// Desmarcar vuelve a Pendientes.
	await leche.getByRole('checkbox', { name: 'Marcar como pendiente' }).click();
	await expect(leche).not.toHaveClass(/opacity-60/);
	await expect(leche.locator('p').first()).not.toHaveClass(/line-through/);
});

test('con todo comprado, el listado lo celebra', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: lista.id, name: 'Leche', purchased: true, order: 0 });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Super' }).getByText('Todo comprado')).toBeVisible();
});

test('al volver a la pestaña: lo tecleado NO se machaca y el refresco llega al estar limpio', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: lista.id, name: 'Leche', order: 0 });
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	// Alta rápida a medias (tainted para superforms).
	await page.locator('#add-name').fill('Huevos');

	// «Otro miembro» añade un item mientras estamos fuera…
	await createItem({ listId: lista.id, name: 'Papel higiénico', order: 1 });
	// …y volvemos a la pestaña: el efecto NO debe revalidar con el alta sucia.
	await volverALaPestana(page);
	await expect(page.locator('#add-name')).toHaveValue('Huevos');
	await expect(page.locator('li', { hasText: 'Papel higiénico' })).toHaveCount(0);

	// Formulario devuelto a su valor base (deja de estar tainted): la misma
	// vuelta a la pestaña ahora SÍ refresca, sin perder lo que no hay.
	await page.locator('#add-name').fill('');
	await volverALaPestana(page);
	await expect(page.locator('li', { hasText: 'Papel higiénico' })).toBeVisible();
	await expect(page.locator('#add-name')).toHaveValue('');
});

test('el toggle optimista revierte si el servidor rechaza', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	const item = await createItem({ listId: lista.id, name: 'Leche', order: 0 });
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	// La lista desaparece «por debajo» (otro miembro la borró): el POST de
	// comprado falla y el checkbox debe volver a su estado original.
	await prisma.list.delete({ where: { id: lista.id } });
	await page.getByRole('checkbox', { name: 'Marcar como comprado' }).click();

	// El fallo se avisa, el optimista se retira y el item vuelve a pendiente
	// con los datos que traía la página (no hay update en fallo).
	await expect(page.getByText('Ese item ya no existe.')).toBeVisible();
	const leche = page.locator('li', { hasText: 'Leche' });
	await expect(leche).toBeVisible();
	await expect(leche.getByRole('checkbox', { name: 'Marcar como comprado' })).toBeVisible();
	await expect(leche.getByRole('checkbox')).not.toBeChecked();
	// Y en la BD todo borrado en cascada.
	await expect(prisma.item.findUnique({ where: { id: item.id } })).resolves.toBeNull();
});
