import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import {
	createFamily,
	createMealPlan,
	createPantryItem,
	createUser,
	resetDb
} from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

// ----------------------------------------------------------------------------
// Claves de fecha, duplicadas aquí a PROPÓSITO: el mes en vista lo resuelve el
// SERVIDOR (`monthKeyOf` de `./grid.ts`) en la zona de la app (`APP_TIME_ZONE`
// de `#lib/format.js`) y el spec compone las mismas claves con la misma `Intl`
// para sembrar y pulsar los días — sin importar la ruta, que el proceso del
// test no pasa por Vite (el mismo motivo por el que `seed.ts` replica
// `normalizeItemName`).
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

/** El mes anterior o siguiente de una clave validada (`delta` negativo, atrás). */
function shiftMonth(monthKey: string, delta: number): string {
	const [year, month] = monthKey.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
	return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** La clave `YYYY-MM-DD` de UN día del mes: la identidad de las celdas. */
function dayKey(monthKey: string, day: number): string {
	return `${monthKey}-${String(day).padStart(2, '0')}`;
}

/** El título del mes tal y como lo compone el servidor con la locale `es` (`monthLabelOf`). */
function monthLabel(monthKey: string): string {
	const [year, month] = monthKey.split('-').map(Number);
	return new Intl.DateTimeFormat('es', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * La vista del calendario en SU pestaña de menús (#222): la vista por defecto
 * es la de Gastos (el esqueleto de #217), así que hay que pulsar la pestaña
 * antes de tocar las celdas — el grid de Gastos no tiene días pulsables.
 */
async function openMenuTab(page: Page): Promise<void> {
	await page.goto('/calendar');
	await waitForHydration(page);
	await page.getByRole('tab', { name: 'Menú' }).click();
}

/**
 * El `<dialog>` ABIERTO que contiene el elemento dado. El detalle del día
 * (#221) se queda ABIERTO debajo del modal de crear/editar/borrar — `<dialog>`
 * nativos apilados — y `dialog[open]` matchea DOS de ellos a la vez: el
 * discriminador es el contenido (la acción del formulario en los tres modales,
 * el heading en el detalle), NO el orden del DOM ni el de apertura.
 */
function modalAbierto(page: Page, dentro: Locator): Locator {
	return page.locator('dialog[open]').filter({ has: dentro });
}

/** El modal de crear menú, apilado o solo (`?/create`, nunca en edición). */
const modalCrear = (page: Page) => modalAbierto(page, page.locator('form[action="?/create"]'));

/** El modal de crear REUTILIZADO en edición (`?/update`, #221). */
const modalEditar = (page: Page) => modalAbierto(page, page.locator('form[action="?/update"]'));

/** La confirmación de borrar (`?/delete`, patrón de familias y categorías). */
const modalBorrar = (page: Page) => modalAbierto(page, page.locator('form[action="?/delete"]'));

/** El detalle del día (#221): el único modal con SU heading. */
const modalDetalle = (page: Page) =>
	modalAbierto(page, page.getByRole('heading', { name: 'Menús del día' }));

test('crear menu desde una celda vacia: chip en la celda y detalle del dia con ingredientes', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	await seedSession(page, user);

	await openMenuTab(page);

	// Sin menús aún: el aviso de vacío bajo el grid (#222).
	await expect(page.getByText('Todavía no hay menús este mes.')).toBeVisible();

	// Un día SIN menús: pulsarlo abre directamente el modal de crear (#221),
	// con el día fijado a la celda pulsada (badge, no editable).
	await page.getByRole('button', { name: '15', exact: true }).click();
	const creacion = modalCrear(page);
	await expect(creacion.getByRole('heading', { name: 'Crear menú' })).toBeVisible();
	await expect(creacion.getByText(dayKey(month, 15))).toBeVisible();

	// Título, tipo de comida y DOS ingredientes: uno nuevo con cantidad y
	// unidad, y otro en una segunda fila con su cantidad por defecto (1 ud).
	await creacion.locator('#meal-title').fill('Lentejas con verduras');
	await creacion.locator('#meal-type').selectOption({ label: 'Cena' });
	await creacion.locator('#meal-ingredient-name-0').fill('Lentejas castellanas');
	await creacion.locator('#meal-ingredient-quantity-0').fill('500');
	await creacion.locator('#meal-ingredient-unit-0').selectOption({ label: 'g' });
	await creacion.getByRole('button', { name: 'Añadir ingrediente' }).click();
	await creacion.locator('#meal-ingredient-name-1').fill('Pimiento rojo');

	await creacion.getByRole('button', { name: 'Crear menú' }).click();

	// Éxito FUERA del modal (#222): cierra el modal y avisa en la página…
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú creado.');
	// …y el menú aparece en SU celda por el título.
	const celda = page.getByRole('button', { name: 'Lentejas con verduras' });
	await expect(celda).toBeVisible();
	await expect(page.getByText('Todavía no hay menús este mes.')).toHaveCount(0);

	// Pulsar el día AHORA abre su DETALLE (#221): el tipo, el título y los
	// ingredientes — cantidad con los separadores de la locale y unidad
	// traducida, como los pinta el modal del detalle.
	await celda.click();
	const detalle = modalDetalle(page);
	await expect(detalle.getByText(dayKey(month, 15))).toBeVisible();
	await expect(detalle.getByText('Cena', { exact: true })).toBeVisible();
	await expect(detalle.getByRole('heading', { name: 'Lentejas con verduras' })).toBeVisible();
	await expect(detalle.getByText('500 g')).toBeVisible();
	await expect(detalle.getByText('Lentejas castellanas')).toBeVisible();
	await expect(detalle.getByText('1 ud')).toBeVisible();
	await expect(detalle.getByText('Pimiento rojo')).toBeVisible();

	// Y la verdad quedó en la BD: un menú (día y tipo exactos) con dos
	// ingredientes en su orden de formulario.
	const menu = await prisma.mealPlan.findFirstOrThrow({
		where: { organizationId: family.id, title: 'Lentejas con verduras' }
	});
	expect(menu.mealType).toBe('dinner');
	expect(menu.date.toISOString().slice(0, 10)).toBe(dayKey(month, 15));
	const ingredientes = await prisma.mealPlanIngredient.findMany({
		where: { mealPlanId: menu.id },
		orderBy: { position: 'asc' }
	});
	expect(ingredientes.map((row) => [row.name, Number(row.quantity), row.unit])).toEqual([
		['Lentejas castellanas', 500, 'gram'],
		['Pimiento rojo', 1, 'unit']
	]);
});

test('guardar un menu crea los productos nuevos en la despensa a cero sin tocar los que ya estaban', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	// La leche ya vive en la despensa: nombrarla en el menú NO es comprarla.
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		normalizedName: 'leche entera',
		quantity: 2,
		unit: 'liter'
	});
	await seedSession(page, user);

	await openMenuTab(page);

	await page.getByRole('button', { name: '8', exact: true }).click();
	const creacion = modalCrear(page);
	await creacion.locator('#meal-title').fill('Tostadas de aguacate');
	await creacion.locator('#meal-ingredient-name-0').fill('Leche entera');
	await creacion.locator('#meal-ingredient-unit-0').selectOption({ label: 'L' });
	await creacion.getByRole('button', { name: 'Añadir ingrediente' }).click();
	await creacion.locator('#meal-ingredient-name-1').fill('Tempeh');
	await creacion.locator('#meal-ingredient-unit-1').selectOption({ label: 'paquete' });
	await creacion.getByRole('button', { name: 'Crear menú' }).click();

	await expect(creacion).toHaveCount(0);

	// La verdad en la BD: el producto NUEVO nace a CERO en su unidad…
	const tempeh = await prisma.pantryItem.findFirstOrThrow({ where: { name: 'Tempeh' } });
	expect(Number(tempeh.quantity)).toBe(0);
	expect(tempeh.unit).toBe('package');
	// …y el que YA estaba conserva su cantidad: un menú no es una compra.
	const leche = await prisma.pantryItem.findFirstOrThrow({ where: { name: 'Leche entera' } });
	expect(Number(leche.quantity)).toBe(2);

	// Y en la vista de la despensa: el nuevo abajo, en «Agotados», a cero;
	// la leche sigue en su sitio con sus dos litros.
	await page.goto('/pantry');
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();
	const filaTempeh = page.locator('li', { hasText: 'Tempeh' });
	await expect(filaTempeh).toBeVisible();
	await expect(filaTempeh.getByText('0 paquete')).toBeVisible();
	await expect(page.locator('li', { hasText: 'Leche entera' }).getByText('2 L')).toBeVisible();
});

test('editar precarga el modal, guarda los cambios y los pinta al instante en celda y detalle', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	const menu = await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 20),
		mealType: 'dinner',
		title: 'Tortilla de patatas',
		ingredients: [
			{ name: 'Huevos', quantity: 6, unit: 'unit' },
			{ name: 'Cebolla', quantity: 1, unit: 'kilogram' }
		]
	});
	await seedSession(page, user);

	await openMenuTab(page);

	// Día con menús: pulsarlo abre el DETALLE (#221), no el modal de crear.
	await page.getByRole('button', { name: 'Tortilla de patatas' }).click();
	const detalle = modalDetalle(page);
	await expect(detalle.getByRole('heading', { name: 'Menús del día' })).toBeVisible();

	// Editar desde el artículo del menú: el modal de crear REUTILIZADO y
	// PRECARGADO (#221) — título, tipo e ingredientes en su orden.
	await detalle
		.locator('article', { hasText: 'Tortilla de patatas' })
		.getByRole('button', { name: 'Editar menú' })
		.click();
	const edicion = modalEditar(page);
	await expect(edicion.getByRole('heading', { name: 'Editar menú' })).toBeVisible();
	await expect(edicion.locator('#meal-title')).toHaveValue('Tortilla de patatas');
	await expect(edicion.locator('#meal-type')).toHaveValue('dinner');
	await expect(edicion.locator('#meal-ingredient-name-0')).toHaveValue('Huevos');
	await expect(edicion.locator('#meal-ingredient-quantity-0')).toHaveValue('6');
	await expect(edicion.locator('#meal-ingredient-name-1')).toHaveValue('Cebolla');

	// Cambia el título, QUITA el ingrediente de la segunda fila (la cebolla)
	// y añade OTRO al final.
	await edicion.locator('#meal-title').fill('Tortilla francesa');
	await edicion
		.locator('div.bg-base-200')
		.filter({ has: page.locator('#meal-ingredient-name-1') })
		.getByRole('button', { name: 'Quitar ingrediente' })
		.click();
	await edicion.getByRole('button', { name: 'Añadir ingrediente' }).click();
	await edicion.locator('#meal-ingredient-name-1').fill('Pimentón dulce');
	await edicion.locator('#meal-ingredient-quantity-1').fill('0.5');
	await edicion.locator('#meal-ingredient-unit-1').selectOption({ label: 'g' });

	await edicion.getByRole('button', { name: 'Guardar cambios' }).click();

	// Éxito: el modal cierra y el aviso llega a la página…
	await expect(edicion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú actualizado.');
	// …la celda pinta el título NUEVO…
	await expect(page.getByRole('button', { name: 'Tortilla francesa' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Tortilla de patatas' })).toHaveCount(0);
	// …y el detalle, que siguió ABIERTO debajo, repinta con los ingredientes
	// sustituidos: huevos y pimentón (0,5 g con el separador español), la
	// cebolla fuera.
	await expect(detalle.getByRole('heading', { name: 'Tortilla francesa' })).toBeVisible();
	await expect(detalle.getByText('Huevos')).toBeVisible();
	await expect(detalle.getByText('Pimentón dulce')).toBeVisible();
	await expect(detalle.getByText('0,5 g')).toBeVisible();
	await expect(detalle.getByText('Cebolla')).toHaveCount(0);

	// La verdad en la BD: título nuevo y la edición sustituye los
	// ingredientes ENTERA (borra y crea con la posición recalculada).
	const guardado = await prisma.mealPlan.findUniqueOrThrow({ where: { id: menu.id } });
	expect(guardado.title).toBe('Tortilla francesa');
	expect(guardado.mealType).toBe('dinner');
	const ingredientes = await prisma.mealPlanIngredient.findMany({
		where: { mealPlanId: menu.id },
		orderBy: { position: 'asc' }
	});
	expect(ingredientes.map((row) => [row.name, Number(row.quantity), row.unit])).toEqual([
		['Huevos', 6, 'unit'],
		['Pimentón dulce', 0.5, 'gram']
	]);
});

test('duplicado dia+tipo: el error se queda en el modal y no se crea nada', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 12),
		mealType: 'lunch',
		title: 'Puchero',
		ingredients: [{ name: 'Garbanzos' }]
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

	// El tipo por defecto es «Comida»: el MISMO que ya ocupa el día. La
	// creación muere en el único (familia, fecha, tipo) y la UI lo traduce
	// al mensaje genérico, DENTRO del modal, que sigue abierto. (El nombre
	// del ingrediente ha de ser válido: si no, lo corta antes el schema en
	// cliente y el error de servidor no llega a verse.)
	await creacion.locator('#meal-title').fill('Segundo puchero');
	await creacion.locator('#meal-ingredient-name-0').fill('Más garbanzos');
	await creacion.getByRole('button', { name: 'Crear menú' }).click();
	await expect(
		creacion.getByText('Ya hay un menú de ese tipo ese día: elige otro tipo de comida.')
	).toBeVisible();
	await expect(creacion.getByRole('heading', { name: 'Crear menú' })).toBeVisible();
	// Sin duplicar: ni en la celda ni en la BD.
	await expect(page.getByRole('button', { name: 'Segundo puchero' })).toHaveCount(0);
	expect(await prisma.mealPlan.count({ where: { organizationId: family.id } })).toBe(1);

	// El remedio que el propio aviso ofrece — otro tipo de comida — guarda.
	await creacion.locator('#meal-type').selectOption({ label: 'Cena' });
	await creacion.getByRole('button', { name: 'Crear menú' }).click();
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú creado.');
	// El detalle, debajo, repinta LOS dos menús del día (comida primero).
	await expect(detalle.getByRole('heading', { name: 'Puchero', exact: true })).toBeVisible();
	await expect(detalle.getByRole('heading', { name: 'Segundo puchero' })).toBeVisible();
	expect(await prisma.mealPlan.count({ where: { organizationId: family.id } })).toBe(2);
});

test('borrar con confirmacion: fuera de la celda y, el ultimo, el dia vuelve a ofrecer crear', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	const comida = await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 7),
		mealType: 'lunch',
		title: 'Risotto',
		ingredients: [{ name: 'Arroz', quantity: 300, unit: 'gram' }]
	});
	const cena = await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 7),
		mealType: 'dinner',
		title: 'Sopa de fideos'
	});
	await seedSession(page, user);

	await openMenuTab(page);

	// Los DOS títulos conviven en la celda del día.
	await expect(page.getByRole('button', { name: 'Risotto' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sopa de fideos' })).toBeVisible();

	// Borrar el primero: el detalle abre y su confirmación APILA encima.
	await page.getByRole('button', { name: 'Risotto' }).click();
	const detalle = modalDetalle(page);
	await detalle
		.locator('article', { hasText: 'Risotto' })
		.getByRole('button', { name: 'Borrar menú' })
		.click();
	const confirmacion = modalBorrar(page);
	await expect(confirmacion.getByRole('heading', { name: '¿Borrar «Risotto»?' })).toBeVisible();
	await confirmacion.getByRole('button', { name: 'Borrar definitivamente' }).click();

	// Confirmado: aviso en la página, fuera de la celda y de la BD… y la
	// despensa NO cambia (borrar un menú no es tirar la compra).
	await expect(confirmacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Menú borrado.');
	await expect(page.getByRole('button', { name: 'Risotto' })).toHaveCount(0);
	await expect(prisma.mealPlan.findUnique({ where: { id: comida.id } })).resolves.toBeNull();
	expect(await prisma.pantryItem.count()).toBe(0);

	// El detalle, que siguió ABIERTO debajo, repinta: queda la sopa, no el
	// risotto.
	await expect(detalle.getByRole('heading', { name: 'Sopa de fideos' })).toBeVisible();
	await expect(detalle.getByRole('heading', { name: 'Risotto' })).toHaveCount(0);

	// El ÚLTIMO menú también se borra: el detalle queda en su estado vacío.
	await detalle
		.locator('article', { hasText: 'Sopa de fideos' })
		.getByRole('button', { name: 'Borrar menú' })
		.click();
	await modalBorrar(page).getByRole('button', { name: 'Borrar definitivamente' }).click();
	await expect(detalle.getByText('Este día no tiene menús.')).toBeVisible();
	await expect(prisma.mealPlan.findUnique({ where: { id: cena.id } })).resolves.toBeNull();

	// Cerrar el detalle (escape, el diálogo abierto más arriba): el día ya
	// NO tiene detalle — pulsarlo vuelve a abrir el CREAR (#221).
	await page.keyboard.press('Escape');
	await expect(detalle).toHaveCount(0);
	await page.getByRole('button', { name: '7', exact: true }).click();
	await expect(modalCrear(page).getByRole('heading', { name: 'Crear menú' })).toBeVisible();
});

test('navegar de mes cambia la query y cada celda sigue mostrando SU mes', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	const siguiente = shiftMonth(month, 1);
	// Un menú ESTE mes y otro EL SIGUIENTE: cada grid solo enseña el suyo.
	await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(month, 5),
		mealType: 'lunch',
		title: 'Menu de este mes'
	});
	await createMealPlan({
		familyId: family.id,
		dateKey: dayKey(siguiente, 10),
		mealType: 'dinner',
		title: 'Menu del mes que viene'
	});
	await seedSession(page, user);

	await openMenuTab(page);

	// Mes actual: su título (compuesto en servidor con la locale) y su menú;
	// el del mes siguiente NO sale.
	const nav = page.getByRole('navigation', { name: 'Navegación de mes' });
	await expect(nav.locator('p')).toHaveText(monthLabel(month));
	await expect(page.getByRole('button', { name: 'Menu de este mes' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Menu del mes que viene' })).toHaveCount(0);

	// «Mes siguiente»: una navegación de verdad — query param nuevo y grid
	// recalculado en servidor.
	await page.getByRole('button', { name: 'Mes siguiente' }).click();
	await expect(page).toHaveURL(new RegExp(`month=${siguiente}$`));
	await expect(nav.locator('p')).toHaveText(monthLabel(siguiente));
	// La pestaña remonta la página y vuelve a Gastos (estado local): tocarla
	// de nuevo para mirar las celdas del mes en vista.
	await page.getByRole('tab', { name: 'Menú' }).click();
	await expect(page.getByRole('button', { name: 'Menu del mes que viene' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Menu de este mes' })).toHaveCount(0);

	// Y «Mes anterior» de vuelta: el query param y las celdas, otra vez las
	// del mes de hoy.
	await page.getByRole('button', { name: 'Mes anterior' }).click();
	await expect(page).toHaveURL(new RegExp(`month=${month}$`));
	await expect(nav.locator('p')).toHaveText(monthLabel(month));
	await page.getByRole('tab', { name: 'Menú' }).click();
	await expect(page.getByRole('button', { name: 'Menu de este mes' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Menu del mes que viene' })).toHaveCount(0);
});
