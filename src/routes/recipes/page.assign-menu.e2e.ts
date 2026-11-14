import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import {
	createFamily,
	createMealPlan,
	createPantryItem,
	createRecipe,
	createUser,
	resetDb
} from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

// ----------------------------------------------------------------------------
// La clave del día de HOY en la zona de la app, duplicada aquí a PROPÓSITO:
// «hoy» lo resuelve el SERVIDOR (`dateKeyOf` de `../calendar/grid.ts`, la
// misma `Intl` con `APP_TIME_ZONE`) y el spec compone la misma clave para
// sembrar y comprobar — sin importar la ruta, que el proceso del test no
// pasa por Vite (el mismo motivo por el que `seed.ts` replica
// `normalizeItemName`).
// ----------------------------------------------------------------------------
const APP_TIME_ZONE = 'Europe/Madrid';

/** Una parte de `formatToParts`, garantizada por haberla pedido al formatear. */
function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
	const value = parts.find((part) => part.type === type)?.value;
	if (value === undefined) throw new RangeError(`Intl no devolvió la parte ${type}`);
	return value;
}

/** El día de hoy EN LA ZONA DE LA APP, como clave `YYYY-MM-DD`. */
function todayKey(now = new Date()): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: APP_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(now);
	return `${partOf(parts, 'year')}-${partOf(parts, 'month')}-${partOf(parts, 'day')}`;
}

/** La vista de recetas, ya hidratada (mismo motivo que en `page.svelte.e2e.ts`). */
async function openRecipes(page: Page): Promise<void> {
	await page.goto('/recipes');
	await waitForHydration(page);
}

/**
 * El `<dialog>` ABIERTO que contiene el elemento dado. Crear/editar/asignar/
 * borrar son `<dialog>` nativos y `dialog[open]` puede matchear más de uno:
 * el discriminador es el contenido (la acción del formulario).
 */
function modalAbierto(page: Page, dentro: Locator): Locator {
	return page.locator('dialog[open]').filter({ has: dentro });
}

/** El modal de asignar al menú (`?/assignToMenu`, #242). */
const modalAsignar = (page: Page) =>
	modalAbierto(page, page.locator('form[action="?/assignToMenu"]'));

/** La fila del listado de UNA receta (por su nombre visible). */
const filaDe = (page: Page, nombre: string) => page.locator('li', { hasText: nombre });

test('asignar al menu: modal prefijado desde la receta, snapshot en el calendario y despensa a cero', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	// El aceite ya vive en la despensa: nombrarlo en la receta no lo compró y
	// asignar el menú tampoco (solo los FALTANTES entran a cero).
	const aceite = await createPantryItem({
		familyId: family.id,
		name: 'Aceite de oliva',
		normalizedName: 'aceite de oliva',
		quantity: 2,
		unit: 'liter'
	});
	const receta = await createRecipe({
		familyId: family.id,
		name: 'Lentejas con verduras',
		servings: 4,
		ingredients: [
			{ name: 'Lentejas pardinas', quantity: 0.5, unit: 'kilogram' },
			{ name: 'Cebolla', quantity: 2, unit: 'unit' }
		]
	});
	await seedSession(page, user);

	await openRecipes(page);

	await filaDe(page, 'Lentejas con verduras')
		.getByRole('button', { name: 'Añadir al menú' })
		.click();
	const asignacion = modalAsignar(page);
	await expect(asignacion.getByRole('heading', { name: 'Añadir al menú' })).toBeVisible();

	// Prefijado desde la receta: su título y sus DOS ingredientes en su
	// orden, con cantidad y unidad de cada uno…
	await expect(asignacion.locator('#assign-title')).toHaveValue('Lentejas con verduras');
	await expect(asignacion.locator('#assign-ingredient-name-0')).toHaveValue('Lentejas pardinas');
	await expect(asignacion.locator('#assign-ingredient-quantity-0')).toHaveValue('0.5');
	await expect(asignacion.locator('#assign-ingredient-unit-0')).toHaveValue('kilogram');
	await expect(asignacion.locator('#assign-ingredient-name-1')).toHaveValue('Cebolla');
	await expect(asignacion.locator('#assign-ingredient-quantity-1')).toHaveValue('2');
	// …el día por defecto es el «hoy» que sirvió el load y el tipo, comida.
	await expect(asignacion.getByText(todayKey())).toBeVisible();
	await expect(asignacion.locator('#assign-meal-type')).toHaveValue('lunch');

	// Editable: sube las lentejas a 1 kg antes de guardar — el snapshot será
	// el de AHORA, no el que vive en la receta.
	await asignacion.locator('#assign-ingredient-quantity-0').fill('1');

	await asignacion.getByRole('button', { name: 'Añadir al menú' }).click();

	// Éxito FUERA del modal (#222): cierra el modal y avisa en la página.
	await expect(asignacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú creado.');

	// La verdad en la BD: un menú HOY a comida, con el título de la receta,
	// los ingredientes SNAPSHOTADOS (las lentejas editadas, la cebolla tal
	// cual) y el recipeId apuntando a su receta de origen.
	const menu = await prisma.mealPlan.findFirstOrThrow({ where: { organizationId: family.id } });
	expect(menu.title).toBe('Lentejas con verduras');
	expect(menu.mealType).toBe('lunch');
	expect(menu.date.toISOString().slice(0, 10)).toBe(todayKey());
	expect(menu.recipeId).toBe(receta.id);
	const ingredientes = await prisma.mealPlanIngredient.findMany({
		where: { mealPlanId: menu.id },
		orderBy: { position: 'asc' }
	});
	expect(ingredientes.map((row) => [row.name, Number(row.quantity), row.unit])).toEqual([
		['Lentejas pardinas', 1, 'kilogram'],
		['Cebolla', 2, 'unit']
	]);

	// La despensa garantizada: los DOS faltantes nacen a CERO en su unidad…
	const lentejas = await prisma.pantryItem.findFirstOrThrow({
		where: { name: 'Lentejas pardinas' }
	});
	expect(Number(lentejas.quantity)).toBe(0);
	expect(lentejas.unit).toBe('kilogram');
	const cebolla = await prisma.pantryItem.findFirstOrThrow({ where: { name: 'Cebolla' } });
	expect(Number(cebolla.quantity)).toBe(0);
	// …y el aceite que YA estaba, intacto: un menú no es una compra.
	const aceiteTras = await prisma.pantryItem.findUniqueOrThrow({ where: { id: aceite.id } });
	expect(Number(aceiteTras.quantity)).toBe(2);

	// Y el calendario lo pinta en SU día: la celda lleva el título y el
	// detalle del día, los ingredientes con cantidad y unidad traducidas.
	await page.goto('/calendar');
	await waitForHydration(page);
	await page.getByRole('tab', { name: 'Menú' }).click();
	const celda = page.getByRole('button', { name: 'Lentejas con verduras' });
	await expect(celda).toBeVisible();
	await celda.click();
	const detalle = modalAbierto(page, page.getByRole('heading', { name: 'Menús del día' }));
	await expect(detalle.getByText(todayKey())).toBeVisible();
	await expect(detalle.getByText('Comida', { exact: true })).toBeVisible();
	await expect(detalle.getByText('Lentejas pardinas')).toBeVisible();
	await expect(detalle.getByText('1 kg')).toBeVisible();
	await expect(detalle.getByText('Cebolla')).toBeVisible();
	await expect(detalle.getByText('2 ud')).toBeVisible();
});

test('editar la receta no altera el menu ya asignado: el snapshot vive solo', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const receta = await createRecipe({
		familyId: family.id,
		name: 'Tortilla de patatas',
		ingredients: [
			{ name: 'Huevos', quantity: 6, unit: 'unit' },
			{ name: 'Cebolla', quantity: 1, unit: 'unit' }
		]
	});
	await seedSession(page, user);

	// Asignar por UI (los valores prefijados, sin tocar nada).
	await openRecipes(page);
	await filaDe(page, 'Tortilla de patatas').getByRole('button', { name: 'Añadir al menú' }).click();
	const asignacion = modalAsignar(page);
	await asignacion.getByRole('button', { name: 'Añadir al menú' }).click();
	await expect(asignacion).toHaveCount(0);

	const menu = await prisma.mealPlan.findFirstOrThrow({ where: { organizationId: family.id } });
	expect(menu.recipeId).toBe(receta.id);

	// Editar la receta por UI: otro nombre, quita la cebolla y baja los
	// huevos a 3.
	await filaDe(page, 'Tortilla de patatas').getByRole('button', { name: 'Editar receta' }).click();
	const edicion = modalAbierto(page, page.locator('form[action="?/update"]'));
	await edicion.locator('#recipe-name').fill('Tortilla francesa');
	await edicion
		.locator('div.bg-base-200')
		.filter({ has: page.locator('#recipe-ingredient-name-1') })
		.getByRole('button', { name: 'Quitar ingrediente' })
		.click();
	await edicion.locator('#recipe-ingredient-quantity-0').fill('3');
	await edicion.getByRole('button', { name: 'Guardar cambios' }).click();
	await expect(edicion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Receta actualizada.');

	// El menú NO se enteró: su título y sus ingredientes siguen siendo el
	// snapshot de la asignación; el recipeId solo traza el origen.
	const menuTras = await prisma.mealPlan.findUniqueOrThrow({ where: { id: menu.id } });
	expect(menuTras.title).toBe('Tortilla de patatas');
	expect(menuTras.recipeId).toBe(receta.id);
	const ingredientes = await prisma.mealPlanIngredient.findMany({
		where: { mealPlanId: menu.id },
		orderBy: { position: 'asc' }
	});
	expect(ingredientes.map((row) => [row.name, Number(row.quantity)])).toEqual([
		['Huevos', 6],
		['Cebolla', 1]
	]);

	// La receta, eso sí, cambió de verdad.
	const recetaTras = await prisma.recipe.findUniqueOrThrow({ where: { id: receta.id } });
	expect(recetaTras.name).toBe('Tortilla francesa');
});

test('borrar la receta deja el menu asignado intacto, con recipeId en null', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const receta = await createRecipe({
		familyId: family.id,
		name: 'Risotto de setas',
		ingredients: [{ name: 'Arroz', quantity: 300, unit: 'gram' }]
	});
	await seedSession(page, user);

	// Asignar por UI: el recipeId lo escribe la acción (#242)…
	await openRecipes(page);
	await filaDe(page, 'Risotto de setas').getByRole('button', { name: 'Añadir al menú' }).click();
	const asignacion = modalAsignar(page);
	await asignacion.getByRole('button', { name: 'Añadir al menú' }).click();
	await expect(asignacion).toHaveCount(0);

	const menu = await prisma.mealPlan.findFirstOrThrow({ where: { organizationId: family.id } });
	expect(menu.recipeId).toBe(receta.id);

	// …y borrar la receta con su confirmación.
	await filaDe(page, 'Risotto de setas').getByRole('button', { name: 'Borrar receta' }).click();
	const confirmacion = modalAbierto(page, page.locator('form[action="?/delete"]'));
	await confirmacion.getByRole('button', { name: 'Borrar definitivamente' }).click();
	await expect(confirmacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Receta borrada.');
	await expect(filaDe(page, 'Risotto de setas')).toHaveCount(0);

	// El menú vive solo: mismo título, sus ingredientes… y la FK en null
	// (SetNull): el snapshot no depende de la receta borrada.
	const menuTras = await prisma.mealPlan.findUniqueOrThrow({ where: { id: menu.id } });
	expect(menuTras.title).toBe('Risotto de setas');
	expect(menuTras.recipeId).toBeNull();
	const ingredientes = await prisma.mealPlanIngredient.findMany({
		where: { mealPlanId: menu.id }
	});
	expect(ingredientes.map((row) => [row.name, Number(row.quantity)])).toEqual([['Arroz', 300]]);
});

test('hueco ocupado: el 409 se pinta dentro del modal y otro tipo guarda', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const hoy = todayKey();
	// La comida de HOY ya está ocupada por otro menú.
	await createMealPlan({
		familyId: family.id,
		dateKey: hoy,
		mealType: 'lunch',
		title: 'Puchero'
	});
	const receta = await createRecipe({
		familyId: family.id,
		name: 'Lentejas rapidas',
		ingredients: [{ name: 'Lentejas pardinas', quantity: 0.5, unit: 'kilogram' }]
	});
	await seedSession(page, user);

	await openRecipes(page);
	await filaDe(page, 'Lentejas rapidas').getByRole('button', { name: 'Añadir al menú' }).click();
	const asignacion = modalAsignar(page);

	// El día por defecto (hoy) y el tipo por defecto (comida) chocan con el
	// puchero: el único (familia, fecha, tipo) muere en el servidor y el
	// mensaje sale DENTRO del modal, que sigue abierto para reintentar otro
	// hueco. (El ingrediente prefijado es válido: si no, lo corta antes el
	// schema en cliente y el error de servidor no llega a verse.)
	await asignacion.getByRole('button', { name: 'Añadir al menú' }).click();
	await expect(
		asignacion.getByText('Ya hay un menú de ese tipo ese día: elige otro tipo de comida.')
	).toBeVisible();
	await expect(asignacion.getByRole('heading', { name: 'Añadir al menú' })).toBeVisible();
	expect(await prisma.mealPlan.count({ where: { organizationId: family.id } })).toBe(1);

	// El remedio que el propio aviso ofrece — otro tipo de comida — guarda:
	// cena de hoy, con su recipeId.
	await asignacion.locator('#assign-meal-type').selectOption({ label: 'Cena' });
	await asignacion.getByRole('button', { name: 'Añadir al menú' }).click();
	await expect(asignacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú creado.');
	const menus = await prisma.mealPlan.findMany({ where: { organizationId: family.id } });
	expect(menus).toHaveLength(2);
	const asignado = menus.find((menu) => menu.title === 'Lentejas rapidas');
	expect(asignado?.mealType).toBe('dinner');
	expect(asignado?.date.toISOString().slice(0, 10)).toBe(hoy);
	expect(asignado?.recipeId).toBe(receta.id);
});
