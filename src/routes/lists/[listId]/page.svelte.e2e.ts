import { expect, test } from '@playwright/test';
import { switchBackToTab } from '../../../../e2e/helpers/browser';
import { seedSession, waitForHydration } from '../../../../e2e/helpers/auth';
import { prisma } from '../../../../e2e/helpers/db';
import {
	createCategory,
	createFamily,
	createItem,
	createList,
	createPantryItem,
	createStore,
	createUser,
	resetDb
} from '../../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('el detalle muestra la lista y su alta rápida; items en orden', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({
		familyId: family.id,
		name: 'Frutería',
		color: 'teal',
		icon: 'wine'
	});
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
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

	// El aviso del alta es de ÉXITO (issue #146): verde y role «status», no
	// el rojo de error que confundía la confirmación con un fallo.
	await expect(page.getByRole('status')).toContainText('Item añadido a la lista.');
	await expect(page.locator('.alert-success')).toContainText('Item añadido a la lista.');

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

test('alta con categoria (#172): el chip clasifica el item y la edicion la conserva o la quita', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Frutería' });
	const dairy = await createCategory({ familyId: family.id, name: 'Lácteos' });
	const limpieza = await createCategory({ familyId: family.id, name: 'Limpieza' });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	// El select del alta ofrece las categorías de la familia, en su orden,
	// más el option vacío («Sin categoría»).
	await expect(page.locator('#add-category option')).toHaveText([
		'Sin categoría',
		'Lácteos',
		'Limpieza'
	]);

	await page.locator('#add-name').fill('Leche entera');
	await page.locator('#add-category').selectOption({ label: 'Lácteos' });
	await page.getByRole('button', { name: 'Añadir' }).first().click();

	// El chip clasifica la fila (y solo esa: ninguna otra fila trae categoría).
	const leche = page.locator('li', { hasText: 'Leche entera' });
	await expect(leche).toBeVisible();
	await expect(leche.getByText('Lácteos')).toBeVisible();
	await expect(page.locator('li .badge-sm')).toHaveCount(1);

	// La verdad quedó en el servidor.
	const saved = await prisma.item.findFirstOrThrow({
		where: { listId: list.id, name: 'Leche entera' }
	});
	expect(saved.categoryId).toBe(dairy.id);

	// El formulario queda vacío (y SIN categoría) para encadenar otra alta.
	await expect(page.locator('#add-name')).toHaveValue('');
	await expect(page.locator('#add-category')).toHaveValue('');

	// La edición abre el modal con la categoría del item cargada…
	await leche.getByRole('button', { name: 'Editar item' }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.locator('#edit-category')).toHaveValue(dairy.id);

	// …reclasificar guarda la nueva y el chip sigue…
	await dialog.locator('#edit-category').selectOption({ label: 'Limpieza' });
	await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
	// Texto exacto y no `getByRole('status')`: el aviso de éxito del alta
	// rápida («Item añadido…») sigue en su formulario hasta el próximo envío.
	await expect(page.getByText('Item actualizado.')).toBeVisible();
	await expect(page.locator('li', { hasText: 'Leche entera' }).getByText('Limpieza')).toBeVisible();
	expect(await prisma.item.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
		categoryId: limpieza.id
	});

	// …y «Sin categoría» la quita: sin chip en la fila y sin categoría en la BD.
	await page
		.locator('li', { hasText: 'Leche entera' })
		.getByRole('button', { name: 'Editar item' })
		.click();
	await page.locator('dialog[open]').locator('#edit-category').selectOption('');
	await page.locator('dialog[open]').getByRole('button', { name: 'Guardar cambios' }).click();
	await expect(page.getByText('Item actualizado.')).toBeVisible();
	await expect(page.locator('li', { hasText: 'Leche entera' }).getByText('Limpieza')).toHaveCount(
		0
	);
	expect(await prisma.item.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
		categoryId: null
	});
});

test('la sugerencia autocompleta la categoria de nombres conocidos (#173): despensa y otras listas', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Frutería' });
	const dairy = await createCategory({ familyId: family.id, name: 'Lácteos' });
	const breakfast = await createCategory({ familyId: family.id, name: 'Desayuno' });
	// Dos fuentes de conocimiento: la despensa (con su canónico guardado)…
	await createPantryItem({
		familyId: family.id,
		name: 'Leche Entera',
		normalizedName: 'leche entera',
		categoryId: dairy.id
	});
	// …y un item en OTRA lista de la misma familia: lo conocido es de la
	// familia, no de la lista abierta.
	const other = await createList({ familyId: family.id, name: 'Desayunos' });
	await createItem({ listId: other.id, name: 'Café molido', categoryId: breakfast.id });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	// Teclear un nombre conocido (aquí en MINÚSCULAS, distinto del visible
	// «Leche Entera» de la despensa) rellena el select solo.
	await page.locator('#add-name').fill('leche entera');
	await expect(page.locator('#add-category')).toHaveValue(dairy.id);

	// Otro nombre conocido (de item, con acento y mayúsculas): la sugerencia
	// se SUSTITUYE — la anterior también la puso la sugerencia.
	await page.locator('#add-name').fill('Café Molido');
	await expect(page.locator('#add-category')).toHaveValue(breakfast.id);

	// Un nombre que la familia no conoce: la sugerencia se retira y el
	// select vuelve a «Sin categoría» (no se queda con la del café).
	await page.locator('#add-name').fill('Yogur griego');
	await expect(page.locator('#add-category')).toHaveValue('');

	// Y el alta sale con la sugerencia aplicada: el canónico colapsa también
	// los espacios («leche  entera» ≡ «leche entera») y el chip clasifica.
	await page.locator('#add-name').fill('leche  entera');
	await expect(page.locator('#add-category')).toHaveValue(dairy.id);
	await page.getByRole('button', { name: 'Añadir' }).first().click();

	const leche = page.locator('li', { hasText: 'Leche entera' });
	await expect(leche).toBeVisible();
	await expect(leche.getByText('Lácteos')).toBeVisible();
	expect(await prisma.item.findFirstOrThrow({ where: { listId: list.id } })).toMatchObject({
		name: 'leche  entera',
		categoryId: dairy.id
	});
});

test('la sugerencia nunca impide elegir otra categoria (#173): lo manual manda', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Frutería' });
	const dairy = await createCategory({ familyId: family.id, name: 'Lácteos' });
	const limpieza = await createCategory({ familyId: family.id, name: 'Limpieza' });
	await createPantryItem({
		familyId: family.id,
		name: 'Leche Entera',
		normalizedName: 'leche entera',
		categoryId: dairy.id
	});
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	// Primero sugiere (nombre conocido, select vacío)…
	await page.locator('#add-name').fill('Leche entera');
	await expect(page.locator('#add-category')).toHaveValue(dairy.id);

	// …pero elegir OTRA categoría a mano es sagrado: aunque el nombre siga
	// siendo conocido (retipeado con otras mayúsculas), el select no se mueve.
	await page.locator('#add-category').selectOption({ label: 'Limpieza' });
	await page.locator('#add-name').fill('LECHE ENTERA');
	await expect(page.locator('#add-category')).toHaveValue(limpieza.id);

	// Tampoco un nombre desconocido retira lo manual: solo se retira lo que
	// puso la sugerencia.
	await page.locator('#add-name').fill('Ketchup');
	await expect(page.locator('#add-category')).toHaveValue(limpieza.id);

	// Y vuelta al nombre conocido: lo manual SIGUE mandando — el alta sale
	// con «Limpieza», no con la «Lácteos» que ese nombre sugiere.
	await page.locator('#add-name').fill('Leche entera');
	await expect(page.locator('#add-category')).toHaveValue(limpieza.id);
	await page.getByRole('button', { name: 'Añadir' }).first().click();
	const row = page.locator('li', { hasText: 'Leche entera' });
	await expect(row).toBeVisible();
	await expect(row.getByText('Limpieza')).toBeVisible();
	expect(await prisma.item.findFirstOrThrow({ where: { listId: list.id } })).toMatchObject({
		categoryId: limpieza.id
	});
});

test('la validacion de cantidad corta el alta en cliente', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Frutería' });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
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
	const list = await createList({ familyId: family.id, name: 'Frutería' });
	const item = await createItem({ listId: list.id, name: 'Leche entera', quantity: 1 });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
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
	const row = page.locator('li', { hasText: 'Leche desnatada' });
	await expect(row).toBeVisible();
	await expect(row.getByText('3 L')).toBeVisible();

	const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
	expect(updated.name).toBe('Leche desnatada');
});

test('borrar item con confirmacion', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Frutería' });
	const item = await createItem({ listId: list.id, name: 'Leche entera' });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
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
	const list = await createList({ familyId: family.id, name: 'Super' });
	const itemLeche = await createItem({ listId: list.id, name: 'Leche', order: 0 });
	await createItem({ listId: list.id, name: 'Pan', order: 1 });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
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
	const items = await prisma.item.findMany({ where: { listId: list.id } });
	expect(items.find((row) => row.name === 'Leche')?.purchased).toBe(true);
	expect(items.find((row) => row.name === 'Pan')?.purchased).toBe(false);

	// Desmarcar vuelve a Pendientes… y la verdad queda en la BD (issue #106:
	// el desmarcado no se guardaba, solo el optimista de pantalla).
	await leche.getByRole('checkbox', { name: 'Marcar como pendiente' }).click();
	await expect(leche).not.toHaveClass(/opacity-60/);
	await expect(leche.locator('p').first()).not.toHaveClass(/line-through/);
	const afterUnchecking = await prisma.item.findUniqueOrThrow({ where: { id: itemLeche.id } });
	expect(afterUnchecking.purchased).toBe(false);

	// Y tras recargar el load confirma el estado del servidor: sigue pendiente.
	await page.reload();
	const reloadedMilk = page.locator('li', { hasText: 'Leche' });
	await expect(reloadedMilk.getByRole('checkbox', { name: 'Marcar como comprado' })).toBeVisible();
	await expect(
		prisma.item.findUniqueOrThrow({ where: { id: itemLeche.id } })
	).resolves.toMatchObject({ purchased: false });
});

test('con todo comprado, el listado lo celebra', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: list.id, name: 'Leche', purchased: true, order: 0 });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Super' }).getByText('Todo comprado')).toBeVisible();
});

test('al volver a la pestaña: el refresco llega y lo tecleado NO se machaca', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: list.id, name: 'Leche', order: 0 });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	// Alta rápida a medias (tainted para superforms).
	await page.locator('#add-name').fill('Huevos');

	// «Otro miembro» añade un item mientras estamos fuera…
	await createItem({ listId: list.id, name: 'Papel higiénico', order: 1 });
	// …y volvemos a la pestaña: el refresco llega aunque el alta esté a
	// medias, porque el load ya no rehace ese formulario (#114).
	await switchBackToTab(page);
	await expect(page.locator('li', { hasText: 'Papel higiénico' })).toBeVisible();
	await expect(page.locator('#add-name')).toHaveValue('Huevos');
});

test('lo escrito en el alta rápida no se pierde al marcar un comprado (#114)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: list.id, name: 'Leche', order: 0 });
	await createItem({ listId: list.id, name: 'Pan', order: 1 });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	// Alta rápida a medias y, mientras está en vuelo, una acción AJENA (el
	// toggle de comprado): su revalidación no debe machacar el formulario.
	await page.locator('#add-name').fill('Huevos');
	await page.getByRole('checkbox', { name: 'Marcar como comprado' }).first().click();

	// El toggle SÍ se aplica (la leche baja a «Comprados»)…
	await expect(page.locator('li', { hasText: 'Leche' })).toHaveClass(/opacity-60/);
	// …y «Huevos» sigue en su sitio: lo escrito solo se borra al enviarlo.
	await expect(page.locator('#add-name')).toHaveValue('Huevos');
});

test('lo escrito en el alta rápida no se pierde al editar otro item (#114)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	const item = await createItem({ listId: list.id, name: 'Leche', quantity: 1, order: 0 });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	await page.locator('#add-name').fill('Huevos');
	await page
		.locator('li', { hasText: 'Leche' })
		.getByRole('button', { name: 'Editar item' })
		.click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('#edit-quantity').fill('3');
	await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

	// La edición SÍ se aplica (el aviso de éxito y la fila actualizada)…
	await expect(page.getByRole('status')).toContainText('Item actualizado.');
	await expect(page.locator('li', { hasText: 'Leche' }).getByText('3 ud')).toBeVisible();
	// …y lo escrito sigue.
	await expect(page.locator('#add-name')).toHaveValue('Huevos');
	// `quantity` es Decimal en la BD: se compara como número.
	const saved = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
	expect(Number(saved.quantity)).toBe(3);
});

test('la fila del alta rápida no desborda a 360px (#114)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: list.id, name: 'Leche', order: 0 });
	await seedSession(page, user);

	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	// A 360px (móvil pequeño) la fila cabía «justa» y se apretaba: con
	// flex-wrap el botón baja a su propia línea y sigue dentro del viewport.
	const button = page.getByRole('button', { name: 'Añadir' }).last();
	const box = await button.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.x + box!.width).toBeLessThanOrEqual(360);
	// Y nada desborda la página.
	const width = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth
	}));
	expect(width.scroll).toBeLessThanOrEqual(width.client);
});

test('el toggle optimista revierte si el servidor rechaza', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	const item = await createItem({ listId: list.id, name: 'Leche', order: 0 });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	// La lista desaparece «por debajo» (otro miembro la borró): el POST de
	// comprado falla y el checkbox debe volver a su estado original.
	await prisma.list.delete({ where: { id: list.id } });
	const response = page.waitForResponse((r) => r.url().includes('?/purchased'));
	await page.getByRole('checkbox', { name: 'Marcar como comprado' }).click();

	// El recurso que ya no existe vuelve 404, no 400 (issue #110). Con
	// use:enhance la respuesta HTTP de la acción es siempre 200: el status de
	// fail() viaja en el cuerpo JSON ({ type: 'failure', status }).
	const body = await (await response).json();
	expect(body).toMatchObject({ type: 'failure', status: 404 });

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
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: list.id, name: 'Pan', order: 0 });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	// Sin comprados no hay compra que cerrar (#70): el CTA no aparece.
	await expect(page.getByRole('button', { name: 'Finalizar compra' })).toHaveCount(0);
});

test('finalizar compra: resumen en el modal, total a mano y entrada en el historial', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	const leche = await createItem({ listId: list.id, name: 'Leche', purchased: true, order: 0 });
	await createItem({ listId: list.id, name: 'Pan', order: 1 });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
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
	await expect(prisma.purchaseRecord.findFirst({ where: { listId: list.id } })).resolves.toBeNull();

	// Tampoco pasa un total negativo.
	await dialog.locator('#finalize-total').fill('-1');
	await dialog.getByRole('button', { name: 'Finalizar compra' }).click();
	await expect(dialog.getByText('Escribe un total válido (cero o más).')).toBeVisible();
	await expect(prisma.purchaseRecord.findFirst({ where: { listId: list.id } })).resolves.toBeNull();

	// Total válido: cierra el modal, avisa y la lista queda con los
	// pendientes — la leche desaparece y con ella el CTA de finalizar.
	await dialog.locator('#finalize-total').fill('23.45');
	await dialog.getByRole('button', { name: 'Finalizar compra' }).click();

	await expect(page.getByRole('status')).toContainText('Compra finalizada');
	await expect(page.locator('li', { hasText: 'Leche' })).toHaveCount(0);
	await expect(page.locator('li', { hasText: 'Pan' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Finalizar compra' })).toHaveCount(0);

	// El historial quedó en la BD (#75): snapshot de lista, items, total y
	// quién lo confirmó. Y el item comprado salió de la lista. Sin elegir
	// establecimiento (#185), la compra tampoco lleva tienda (criterio de
	// aceptación: sigue funcionando sin elegirlo).
	const record = await prisma.purchaseRecord.findFirstOrThrow({
		where: { listId: list.id },
		include: { items: true }
	});
	expect(record.listName).toBe('Super');
	expect(record.total.toString()).toBe('23.45');
	expect(record.userId).toBe(user.id);
	expect(record.storeId).toBeNull();
	expect(record.storeName).toBeNull();
	expect(record.items.map((row) => row.name)).toEqual(['Leche']);
	await expect(prisma.item.findUnique({ where: { id: leche.id } })).resolves.toBeNull();
});

test('finalizar con establecimiento (#185): el select ofrece la familia y el historial congela nombre', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: list.id, name: 'Leche', purchased: true, order: 0 });
	// Dos tiendas sembradas en orden: el select las ofrece en el mismo orden
	// de creación que trae el load (`listStores`).
	const mercadona = await createStore({ familyId: family.id, name: 'Mercadona' });
	await createStore({ familyId: family.id, name: 'Frapeluza' });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Finalizar compra' }).click();
	const dialog = page.locator('dialog[open]');

	// El select arranca en «Sin establecimiento» y ofrece las tiendas de LA
	// familia, por orden de creación.
	await expect(dialog.locator('#finalize-store')).toHaveValue('');
	await expect(dialog.locator('#finalize-store option')).toHaveText([
		'Sin establecimiento',
		'Mercadona',
		'Frapeluza'
	]);

	await dialog.locator('#finalize-store').selectOption({ label: 'Mercadona' });
	await dialog.locator('#finalize-total').fill('9.99');
	await dialog.getByRole('button', { name: 'Finalizar compra' }).click();

	await expect(page.getByRole('status')).toContainText('Compra finalizada');
	// La verdad quedó en la BD: la compra lleva la tienda elegida, con el
	// nombre visible congelado en el momento de finalizar.
	expect(
		await prisma.purchaseRecord.findFirstOrThrow({ where: { listId: list.id } })
	).toMatchObject({
		storeId: mercadona.id,
		storeName: 'Mercadona'
	});
});

test('un establecimiento borrado mientras se rellena el modal NO cierra la compra (#185)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: list.id, name: 'Leche', purchased: true, order: 0 });
	const store = await createStore({ familyId: family.id, name: 'Chino de antes' });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Finalizar compra' }).click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('#finalize-store').selectOption({ label: 'Chino de antes' });
	// Otro miembro borra la tienda justo antes de confirmar: el id que viaja
	// queda rancio y el servidor rechaza la compra CON mensaje, sin cerrarla.
	await prisma.store.delete({ where: { id: store.id } });
	await dialog.locator('#finalize-total').fill('5');
	await dialog.getByRole('button', { name: 'Finalizar compra' }).click();

	await expect(dialog.getByRole('alert')).toContainText(
		'El establecimiento elegido ya no existe en esta familia'
	);
	// Nada se cerró: el item sigue comprado y sin historial.
	const row = await prisma.item.findFirstOrThrow({ where: { listId: list.id } });
	expect(row.purchased).toBe(true);
	await expect(prisma.purchaseRecord.findFirst({ where: { listId: list.id } })).resolves.toBeNull();
});

test('cancelar cierra el modal sin finalizar y el total vuelve a empezar vacío', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	const item = await createItem({ listId: list.id, name: 'Leche', purchased: true });
	await createStore({ familyId: family.id, name: 'Mercadona' });
	await seedSession(page, user);

	await page.goto(`/lists/${list.id}`);
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Finalizar compra' }).click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('#finalize-total').fill('10');
	await dialog.locator('#finalize-store').selectOption({ label: 'Mercadona' });
	await dialog.getByRole('button', { name: 'Cancelar' }).click();

	// Nada se cerró: el item sigue comprado (en pantalla y en la BD) y no hay
	// historial.
	await expect(page.locator('li', { hasText: 'Leche' })).toBeVisible();
	const row = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
	expect(row.purchased).toBe(true);
	await expect(prisma.purchaseRecord.findFirst({ where: { listId: list.id } })).resolves.toBeNull();

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
	// El establecimiento elegido tampoco se arrastra (#185): vuelve a «Sin…».
	await expect(page.locator('#finalize-store')).toHaveValue('');
});
