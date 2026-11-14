import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import {
	createFamily,
	createList,
	createMealPlan,
	createPantryItem,
	createUser,
	resetDb
} from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

// ----------------------------------------------------------------------------
// Claves de fecha, duplicadas aquí a PROPÓSITO (ver `page.svelte.e2e.ts`): el
// mes en vista lo resuelve el SERVIDOR en la zona de la app y el spec compone
// las mismas claves con la misma `Intl` para sembrar y pulsar los días — sin
// importar la ruta, que el proceso del test no pasa por Vite.
// ----------------------------------------------------------------------------
const APP_TIME_ZONE = 'Europe/Madrid';

/** Una parte de `formatToParts`, garantizada por haberla pedido al formatear. */
function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
	const value = parts.find((part) => part.type === type)?.value;
	if (value === undefined) throw new RangeError(`Intl no devolvió la parte ${type}`);
	return value;
}

/** El mes actual EN LA ZONA DE LA APP, como clave `YYYY-MM` (la de la query). */
function currentMonthKey(now = new Date()): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: APP_TIME_ZONE,
		year: 'numeric',
		month: '2-digit'
	}).formatToParts(now);
	return `${partOf(parts, 'year')}-${partOf(parts, 'month')}`;
}

/** La clave `YYYY-MM-DD` de UN día del mes: la identidad de las celdas. */
function dayKey(monthKey: string, day: number): string {
	return `${monthKey}-${String(day).padStart(2, '0')}`;
}

/**
 * La vista del calendario en SU pestaña de menús (#222): la vista por defecto
 * es la de Gastos (el esqueleto de #217), así que hay que pulsar la pestaña
 * antes de tocar las celdas.
 */
async function openMenuTab(page: Page): Promise<void> {
	await page.goto('/calendar');
	await waitForHydration(page);
	await page.getByRole('tab', { name: 'Menú' }).click();
}

/** El `<dialog>` ABIERTO que contiene el elemento dado (ver `page.svelte.e2e.ts`). */
function modalAbierto(page: Page, dentro: Locator): Locator {
	return page.locator('dialog[open]').filter({ has: dentro });
}

/** El detalle del día (#221): el único modal con SU heading. */
const modalDetalle = (page: Page) =>
	modalAbierto(page, page.getByRole('heading', { name: 'Menús del día' }));

test('dia con despensa insuficiente: volcar lo que falta deja el deficit exacto en la lista, un solo item', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	const lista = await createList({ familyId: family.id, name: 'Compra semanal' });

	// Huevos JUSTOS a medias: dos comidas del día piden 6 + 6 contra 8 en
	// despensa → el día entero agrega un déficit de 4 ud (el badge de la
	// #244), que es lo que ha de entrar en la lista.
	const huevos = await createPantryItem({
		familyId: family.id,
		name: 'Huevos',
		normalizedName: 'huevos',
		quantity: 8,
		unit: 'unit'
	});
	await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 10),
		mealType: 'lunch',
		title: 'Tortilla',
		ingredients: [{ name: 'Huevos', quantity: 6, unit: 'unit', pantryItemId: huevos.id }]
	});
	await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 10),
		mealType: 'dinner',
		title: 'Revuelto',
		ingredients: [{ name: 'Huevos', quantity: 6, unit: 'unit', pantryItemId: huevos.id }]
	});
	await seedSession(page, user);

	await openMenuTab(page);
	await page.getByRole('button', { name: 'Tortilla' }).click();
	const detalle = modalDetalle(page);

	// El badge del día ya enseña el déficit AGREGADO (6+6 contra 8) en cada
	// ingrediente del mismo producto, y el botón individual está a punto,
	// como el del pie.
	await expect(detalle.getByText('Faltan 4 ud')).toHaveCount(2);
	const botonHuevos = detalle.getByRole('button', {
		name: 'Añadir lo que falta de Huevos a la lista'
	});
	await expect(botonHuevos).toHaveCount(2);
	await expect(botonHuevos.first()).toBeEnabled();
	const botonDia = detalle.getByRole('button', { name: 'Añadir lo que falta del día' });
	await expect(botonDia).toBeEnabled();

	// La lista por defecto es la primera de la familia: ya está seleccionada.
	await botonDia.click();

	// Éxito FUERA del modal (como al crear menú): el detalle cierra y el
	// aviso confirma lo añadido, con el déficit exacto.
	await expect(page.getByRole('status')).toContainText(
		'Añadido a la lista de la compra: Huevos 4 ud.'
	);
	await expect(modalDetalle(page)).toHaveCount(0);

	// La verdad en la BD: UN item (sin duplicados) con el déficit exacto,
	// pendiente de comprar y en su unidad.
	const items = await prisma.item.findMany({ where: { listId: lista.id } });
	expect(items).toHaveLength(1);
	expect(items[0]).toMatchObject({ name: 'Huevos', unit: 'unit', purchased: false });
	expect(Number(items[0].quantity)).toBe(4);

	// La despensa NO se toca: el volcado escribe en la lista (#149).
	const despensa = await prisma.pantryItem.findUniqueOrThrow({ where: { id: huevos.id } });
	expect(Number(despensa.quantity)).toBe(8);
});

test('dia con la despensa justa: el volcado del dia no ofrece nada y avisa sin escribir', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	const lista = await createList({ familyId: family.id, name: 'Compra semanal' });
	const leche = await createPantryItem({
		familyId: family.id,
		name: 'Leche',
		normalizedName: 'leche',
		quantity: 1.5,
		unit: 'liter'
	});
	await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 3),
		mealType: 'breakfast',
		title: 'Café con leche',
		ingredients: [{ name: 'Leche', quantity: 1.5, unit: 'liter', pantryItemId: leche.id }]
	});
	await seedSession(page, user);

	await openMenuTab(page);
	await page.getByRole('button', { name: 'Café con leche' }).click();
	const detalle = modalDetalle(page);

	// Cubierto justo («Suficiente»): ni el botón del día ni el individual
	// se ofrecen activos — nada que volcar.
	await expect(detalle.getByText('Suficiente')).toBeVisible();
	await expect(detalle.getByRole('button', { name: 'Añadir lo que falta del día' })).toBeDisabled();
	await expect(
		detalle.getByRole('button', { name: 'Añadir lo que falta de Leche a la lista' })
	).toBeDisabled();

	// Y la lista queda intacta: el botón deshabilitado no llega a enviar.
	expect(await prisma.item.count({ where: { listId: lista.id } })).toBe(0);
});
