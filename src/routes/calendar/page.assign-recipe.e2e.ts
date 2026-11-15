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
// Claves de fecha, duplicadas aquí a PROPÓSITO (el mismo motivo que en
// `page.svelte.e2e.ts`): «hoy» y el mes en vista los resuelve el SERVIDOR en
// la zona de la app y el spec compone las mismas claves con la misma `Intl`
// para sembrar y pulsar los días — sin importar la ruta, que el proceso del
// test no pasa por Vite.
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
 * es la de Gastos, así que hay que pulsar la pestaña antes de tocar las
 * celdas — el grid de Gastos no tiene días pulsables.
 */
async function openMenuTab(page: Page): Promise<void> {
	await page.goto('/calendar');
	await waitForHydration(page);
	await page.getByRole('tab', { name: 'Menú' }).click();
}

/**
 * El `<dialog>` ABIERTO que contiene el elemento dado. Crear/editar (y el
 * detalle debajo) son `<dialog>` nativos apilados y `dialog[open]` puede
 * matchear más de uno: el discriminador es el contenido (la acción del
 * formulario en los modales, el heading en el detalle).
 */
function modalAbierto(page: Page, dentro: Locator): Locator {
	return page.locator('dialog[open]').filter({ has: dentro });
}

/** El modal de crear menú, apilado o solo (`?/create`, nunca en edición). */
const modalCrear = (page: Page) => modalAbierto(page, page.locator('form[action="?/create"]'));

/** El modal de crear REUTILIZADO en edición (`?/update`, #221). */
const modalEditar = (page: Page) => modalAbierto(page, page.locator('form[action="?/update"]'));

/** El detalle del día (#221): el único modal con SU heading. */
const modalDetalle = (page: Page) =>
	modalAbierto(page, page.getByRole('heading', { name: 'Menús del día' }));

/** El buscador de recetas del modal de crear (#252), por su id propio. */
const buscadorRecetas = (dentro: Locator) => dentro.locator('#meal-recipe-search');

/** La lista de coincidencias del buscador (#252), por su aria-label. */
const resultadosRecetas = (dentro: Locator) =>
	dentro.getByRole('list', { name: 'Recetas que coinciden' });

test('asignar una receta existente al dia: prefijado, recipeId en BD y despensa a cero', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	// El aceite ya vive en la despensa: nombrarlo en la receta no lo compró y
	// asignar el menú tampoco (solo los FALTANTES entran a cero).
	const aceite = await createPantryItem({
		familyId: family.id,
		name: 'Aceite de oliva',
		normalizedName: 'aceite de oliva',
		quantity: 2,
		unit: 'liter'
	});
	await createRecipe({
		familyId: family.id,
		name: 'Lentejas con verduras',
		servings: 4,
		ingredients: [
			{ name: 'Lentejas pardinas', quantity: 0.5, unit: 'kilogram' },
			{ name: 'Cebolla', quantity: 2, unit: 'unit' }
		]
	});
	await seedSession(page, user);

	await openMenuTab(page);

	// Día SIN menús: pulsarlo abre el modal de crear, con el buscador encima
	// del título (#252). Buscar «lentejas» en minúsculas: el match normaliza.
	await page.getByRole('button', { name: '15', exact: true }).click();
	const creacion = modalCrear(page);
	await expect(creacion.getByRole('heading', { name: 'Crear menú' })).toBeVisible();
	await expect(creacion.getByText(dayKey(month, 15))).toBeVisible();
	await buscadorRecetas(creacion).fill('lentejas');

	// La receta coincide: elegirla de la lista precarga título e ingredientes
	// y marca el origen con el chip.
	await resultadosRecetas(creacion).getByRole('button', { name: 'Lentejas con verduras' }).click();
	await expect(creacion.getByText('Desde la receta «Lentejas con verduras»')).toBeVisible();
	await expect(creacion.locator('#meal-title')).toHaveValue('Lentejas con verduras');
	await expect(creacion.locator('#meal-ingredient-name-0')).toHaveValue('Lentejas pardinas');
	await expect(creacion.locator('#meal-ingredient-quantity-0')).toHaveValue('0.5');
	await expect(creacion.locator('#meal-ingredient-unit-0')).toHaveValue('kilogram');
	await expect(creacion.locator('#meal-ingredient-name-1')).toHaveValue('Cebolla');
	await expect(creacion.locator('#meal-ingredient-quantity-1')).toHaveValue('2');
	// El día de la celda y el tipo por defecto se CONSERVAN: la receta solo
	// aporta el contenido.
	await expect(creacion.locator('#meal-type')).toHaveValue('lunch');

	await creacion.getByRole('button', { name: 'Crear menú' }).click();

	// Éxito FUERA del modal (#222): cierra el modal y avisa en la página…
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú creado.');
	// …y el menú aparece en SU celda por el título. La búsqueda se acota al
	// panel de menús: el botón de la receta en la lista de resultados vive
	// en el dialog (ya cerrado) y su nombre colisiona con el de la celda.
	await expect(
		page.locator('#calendar-panel-menu').getByRole('button', { name: 'Lentejas con verduras' })
	).toBeVisible();

	// La verdad en la BD: un menú del día 15 a comida con el recipeId de su
	// receta de origen y los ingredientes SNAPSHOTADOS en su orden.
	const menu = await prisma.mealPlan.findFirstOrThrow({
		where: { organizationId: family.id, title: 'Lentejas con verduras' }
	});
	expect(menu.mealType).toBe('lunch');
	expect(menu.date.toISOString().slice(0, 10)).toBe(dayKey(month, 15));
	expect(menu.recipeId).toBe(
		(await prisma.recipe.findFirstOrThrow({ where: { name: 'Lentejas con verduras' } })).id
	);
	const ingredientes = await prisma.mealPlanIngredient.findMany({
		where: { mealPlanId: menu.id },
		orderBy: { position: 'asc' }
	});
	expect(ingredientes.map((row) => [row.name, Number(row.quantity), row.unit])).toEqual([
		['Lentejas pardinas', 0.5, 'kilogram'],
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
});

test('alta manual sin receta: el menu nace con recipeId en null', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	await seedSession(page, user);

	await openMenuTab(page);

	// Sin tocar el buscador: título e ingredientes a mano, el camino de
	// siempre (#222), que sigue siendo válido (#252).
	await page.getByRole('button', { name: '8', exact: true }).click();
	const creacion = modalCrear(page);
	await creacion.locator('#meal-title').fill('Tostadas de aguacate');
	await creacion.locator('#meal-ingredient-name-0').fill('Aguacate');

	await creacion.getByRole('button', { name: 'Crear menú' }).click();
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú creado.');

	const menu = await prisma.mealPlan.findFirstOrThrow({
		where: { organizationId: family.id, title: 'Tostadas de aguacate' }
	});
	expect(menu.date.toISOString().slice(0, 10)).toBe(dayKey(month, 8));
	expect(menu.recipeId).toBeNull();
});

test('quitar el chip de origen: el contenido prefijado se queda y se guarda sin receta', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	await createRecipe({
		familyId: family.id,
		name: 'Tortilla de patatas',
		ingredients: [
			{ name: 'Huevos', quantity: 6, unit: 'unit' },
			{ name: 'Cebolla', quantity: 1, unit: 'unit' }
		]
	});
	await seedSession(page, user);

	await openMenuTab(page);

	await page.getByRole('button', { name: '20', exact: true }).click();
	const creacion = modalCrear(page);
	await buscadorRecetas(creacion).fill('tortilla');
	await resultadosRecetas(creacion).getByRole('button', { name: 'Tortilla de patatas' }).click();
	await expect(creacion.getByText('Desde la receta «Tortilla de patatas»')).toBeVisible();

	// La X del chip suelta solo el ENLACE: el snapshot ya precargado (título
	// e ingredientes) se queda en el formulario.
	await creacion.getByRole('button', { name: 'Quitar la receta de origen' }).click();
	await expect(creacion.getByText('Desde la receta «Tortilla de patatas»')).toHaveCount(0);
	await expect(creacion.locator('#meal-title')).toHaveValue('Tortilla de patatas');
	await expect(creacion.locator('#meal-ingredient-name-0')).toHaveValue('Huevos');

	await creacion.getByRole('button', { name: 'Crear menú' }).click();
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú creado.');

	const menu = await prisma.mealPlan.findFirstOrThrow({
		where: { organizationId: family.id, title: 'Tortilla de patatas' }
	});
	expect(menu.date.toISOString().slice(0, 10)).toBe(dayKey(month, 20));
	// Sin chip, sin receta: el guardado sale «sin receta» aunque el contenido
	// viniera de ella.
	expect(menu.recipeId).toBeNull();
});

test('hueco ocupado: el 409 se pinta dentro del modal y otro tipo guarda con su receta', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	// La comida del día 15 ya está ocupada por otro menú.
	await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 15),
		mealType: 'lunch',
		title: 'Puchero'
	});
	await createRecipe({
		familyId: family.id,
		name: 'Lentejas rapidas',
		ingredients: [{ name: 'Lentejas pardinas', quantity: 0.5, unit: 'kilogram' }]
	});
	await seedSession(page, user);

	await openMenuTab(page);

	// Día ocupado: el click abre su DETALLE y desde ahí, «crear otro» — el
	// modal de crear APILA sobre el detalle (#221).
	await page.getByRole('button', { name: 'Puchero' }).click();
	const detalle = modalDetalle(page);
	await detalle.getByRole('button', { name: 'Crear otro menú este día' }).click();
	const creacion = modalCrear(page);
	await expect(creacion.getByRole('heading', { name: 'Crear menú' })).toBeVisible();

	// Elegir la receta del buscador y chocar con el hueco ocupado (el MISMO
	// día y el tipo por defecto, comida): el 409 se pinta DENTRO del modal,
	// que sigue abierto para reintentar.
	await buscadorRecetas(creacion).fill('lentejas');
	await resultadosRecetas(creacion).getByRole('button', { name: 'Lentejas rapidas' }).click();
	await expect(creacion.locator('#meal-title')).toHaveValue('Lentejas rapidas');
	await creacion.getByRole('button', { name: 'Crear menú' }).click();
	await expect(
		creacion.getByText('Ya hay un menú de ese tipo ese día: elige otro tipo de comida.')
	).toBeVisible();
	await expect(creacion.getByRole('heading', { name: 'Crear menú' })).toBeVisible();
	expect(await prisma.mealPlan.count({ where: { organizationId: family.id } })).toBe(1);

	// El remedio que el propio aviso ofrece — otro tipo de comida — guarda:
	// cena del día 15, con el contenido prefijado y su recipeId.
	await creacion.locator('#meal-type').selectOption({ label: 'Cena' });
	await creacion.getByRole('button', { name: 'Crear menú' }).click();
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú creado.');
	const asignado = await prisma.mealPlan.findFirstOrThrow({
		where: { organizationId: family.id, title: 'Lentejas rapidas' }
	});
	expect(asignado.mealType).toBe('dinner');
	expect(asignado.date.toISOString().slice(0, 10)).toBe(dayKey(month, 15));
	expect(asignado.recipeId).toBe(
		(await prisma.recipe.findFirstOrThrow({ where: { name: 'Lentejas rapidas' } })).id
	);
});

test('editar un menu nacido de receta: sin buscador y con el recipeId intacto', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	const receta = await createRecipe({
		familyId: family.id,
		name: 'Tortilla de patatas',
		ingredients: [
			{ name: 'Huevos', quantity: 6, unit: 'unit' },
			{ name: 'Cebolla', quantity: 1, unit: 'unit' }
		]
	});
	const menu = await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 20),
		mealType: 'dinner',
		title: 'Tortilla de patatas',
		ingredients: [
			{ name: 'Huevos', quantity: 6, unit: 'unit' },
			{ name: 'Cebolla', quantity: 1, unit: 'unit' }
		]
	});
	// La trazabilidad del origen, como la deja el alta por UI (#242).
	await prisma.mealPlan.update({ where: { id: menu.id }, data: { recipeId: receta.id } });
	await seedSession(page, user);

	await openMenuTab(page);

	await page.getByRole('button', { name: 'Tortilla de patatas' }).click();
	const detalle = modalDetalle(page);
	await detalle
		.locator('article', { hasText: 'Tortilla de patatas' })
		.getByRole('button', { name: 'Editar menú' })
		.click();
	const edicion = modalEditar(page);
	await expect(edicion.getByRole('heading', { name: 'Editar menú' })).toBeVisible();

	// En EDICIÓN no hay buscador de recetas (#252): el origen no se toca al
	// editar — la trazabilidad sobrevive (#242).
	await expect(buscadorRecetas(edicion)).toHaveCount(0);
	await expect(edicion.getByText('Desde la receta «Tortilla de patatas»')).toHaveCount(0);

	// Editar el contenido: el snapshot cambia, el origen NO.
	await edicion.locator('#meal-title').fill('Tortilla francesa');
	await edicion.getByRole('button', { name: 'Guardar cambios' }).click();
	await expect(edicion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú actualizado.');

	const guardado = await prisma.mealPlan.findUniqueOrThrow({ where: { id: menu.id } });
	expect(guardado.title).toBe('Tortilla francesa');
	expect(guardado.recipeId).toBe(receta.id);
});

test('busqueda sin coincidencias: estado vacio y el camino manual disponible', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	// UNA receta en el catálogo: la búsqueda falla por el FILTRO, no por
	// recetario vacío.
	await createRecipe({
		familyId: family.id,
		name: 'Paella',
		ingredients: [{ name: 'Arroz', quantity: 300, unit: 'gram' }]
	});
	await seedSession(page, user);

	await openMenuTab(page);

	await page.getByRole('button', { name: '11', exact: true }).click();
	const creacion = modalCrear(page);
	await buscadorRecetas(creacion).fill('zzz');

	// El estado vacío del buscador (el texto compartido con lista y
	// despensa) y NINGUNA coincidencia que elegir.
	await expect(creacion.getByText('Ningún artículo coincide con la búsqueda.')).toBeVisible();
	await expect(resultadosRecetas(creacion)).toHaveCount(0);
	await expect(creacion.getByRole('button', { name: 'Paella' })).toHaveCount(0);

	// El camino manual sigue ahí: menú a mano, sin receta.
	await creacion.locator('#meal-title').fill('Pizza casera');
	await creacion.locator('#meal-ingredient-name-0').fill('Masa');
	await creacion.getByRole('button', { name: 'Crear menú' }).click();
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú creado.');

	const menu = await prisma.mealPlan.findFirstOrThrow({
		where: { organizationId: family.id, title: 'Pizza casera' }
	});
	expect(menu.date.toISOString().slice(0, 10)).toBe(dayKey(month, 11));
	expect(menu.recipeId).toBeNull();
});
