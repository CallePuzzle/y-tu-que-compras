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
	await expect(
		page.getByText('La cantidad debe ser mayor que 0, con hasta 3 decimales y sin pasar de')
	).toBeVisible();
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
	const itemLeche = await createItem({ listId: lista.id, name: 'Leche', order: 0 });
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

	// Desmarcar vuelve a Pendientes… y la verdad queda en la BD (issue #106:
	// el desmarcado no se guardaba, solo el optimista de pantalla).
	await leche.getByRole('checkbox', { name: 'Marcar como pendiente' }).click();
	await expect(leche).not.toHaveClass(/opacity-60/);
	await expect(leche.locator('p').first()).not.toHaveClass(/line-through/);
	const despuesDeDesmarcar = await prisma.item.findUniqueOrThrow({ where: { id: itemLeche.id } });
	expect(despuesDeDesmarcar.purchased).toBe(false);

	// Y tras recargar el load confirma el estado del servidor: sigue pendiente.
	await page.reload();
	const lecheRecargada = page.locator('li', { hasText: 'Leche' });
	await expect(
		lecheRecargada.getByRole('checkbox', { name: 'Marcar como comprado' })
	).toBeVisible();
	await expect(
		prisma.item.findUniqueOrThrow({ where: { id: itemLeche.id } })
	).resolves.toMatchObject({ purchased: false });
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

test('sin items comprados no se ofrece finalizar la compra', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: lista.id, name: 'Pan', order: 0 });
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	// Sin comprados no hay compra que cerrar (#70): el CTA no aparece.
	await expect(page.getByRole('button', { name: 'Finalizar compra' })).toHaveCount(0);
});

test('finalizar compra: resumen en el modal, total a mano y entrada en el historial', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	const leche = await createItem({ listId: lista.id, name: 'Leche', purchased: true, order: 0 });
	await createItem({ listId: lista.id, name: 'Pan', order: 1 });
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	// El resumen del modal trae SOLO los comprados: la leche (con su
	// cantidad) está; el pan, pendiente, no. (Exactos: el texto de la fila
	// del resumen es «nombre» y «cantidad unidad», y así no casan ancestros.)
	await page.getByRole('button', { name: 'Finalizar compra' }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Finalizar compra' })).toBeVisible();
	await expect(dialog.getByText('Resumen de la compra')).toBeVisible();
	await expect(dialog.getByText('Leche', { exact: true })).toBeVisible();
	await expect(dialog.getByText('1 ud', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Pan', { exact: true })).toHaveCount(0);

	// Sin total no hay envío: el schema lo corta en cliente, sin historial.
	await dialog.getByRole('button', { name: 'Finalizar compra' }).click();
	await expect(dialog.getByText('Escribe un total válido (cero o más).')).toBeVisible();
	await expect(
		prisma.purchaseRecord.findFirst({ where: { listId: lista.id } })
	).resolves.toBeNull();

	// Tampoco pasa un total negativo.
	await dialog.locator('#finalize-total').fill('-1');
	await dialog.getByRole('button', { name: 'Finalizar compra' }).click();
	await expect(dialog.getByText('Escribe un total válido (cero o más).')).toBeVisible();
	await expect(
		prisma.purchaseRecord.findFirst({ where: { listId: lista.id } })
	).resolves.toBeNull();

	// Total válido: cierra el modal, avisa y la lista queda con los
	// pendientes — la leche desaparece y con ella el CTA de finalizar.
	await dialog.locator('#finalize-total').fill('23.45');
	await dialog.getByRole('button', { name: 'Finalizar compra' }).click();

	await expect(page.getByRole('status')).toContainText('Compra finalizada');
	await expect(page.locator('li', { hasText: 'Leche' })).toHaveCount(0);
	await expect(page.locator('li', { hasText: 'Pan' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Finalizar compra' })).toHaveCount(0);

	// El historial quedó en la BD (#75): snapshot de lista, items, total y
	// quién lo confirmó. Y el item comprado salió de la lista.
	const record = await prisma.purchaseRecord.findFirstOrThrow({
		where: { listId: lista.id },
		include: { items: true }
	});
	expect(record.listName).toBe('Super');
	expect(record.total.toString()).toBe('23.45');
	expect(record.userId).toBe(user.id);
	expect(record.items.map((row) => row.name)).toEqual(['Leche']);
	await expect(prisma.item.findUnique({ where: { id: leche.id } })).resolves.toBeNull();
});

test('cancelar cierra el modal sin finalizar y el total vuelve a empezar vacío', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	const item = await createItem({ listId: lista.id, name: 'Leche', purchased: true });
	await seedSession(page, user);

	await page.goto(`/lists/${lista.id}`);
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Finalizar compra' }).click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('#finalize-total').fill('10');
	await dialog.getByRole('button', { name: 'Cancelar' }).click();

	// Nada se cerró: el item sigue comprado (en pantalla y en la BD) y no hay
	// historial.
	await expect(page.locator('li', { hasText: 'Leche' })).toBeVisible();
	const row = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
	expect(row.purchased).toBe(true);
	await expect(
		prisma.purchaseRecord.findFirst({ where: { listId: lista.id } })
	).resolves.toBeNull();

	// Al reabrir, el total empieza EN BLANCO (el 0 default del schema no se
	// pinta, y lo tecleado antes no se arrastra).
	//
	// PERO daisyUI oculta el modal cerrado con `visibility` y una transición
	// `allow-discrete`: ~300ms tras `close()` el contenido SIGUE expuesto en
	// el árbol de accesibilidad (el atributo `open` ya se ha retirado, pero
	// el CSS del autor pisa el `display: none` del UA). Esperar a que el
	// botón del modal salga del árbol, o reabrir ahora mismo sería ambiguo
	// (dos «Finalizar compra» y strict mode en click).
	await expect(page.getByRole('button', { name: 'Finalizar compra' })).toHaveCount(1);
	await page.getByRole('button', { name: 'Finalizar compra' }).click();
	await expect(page.locator('dialog[open]')).toBeVisible();
	await expect(page.locator('#finalize-total')).toHaveValue('');
});
