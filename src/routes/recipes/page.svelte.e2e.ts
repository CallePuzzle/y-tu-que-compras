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

/** La vista de recetas, ya hidratada: sin hidración, un click inmediato tras
 * `goto()` puede caer antes de que los manejadores estén registrados. */
async function openRecipes(page: Page): Promise<void> {
	await page.goto('/recipes');
	await waitForHydration(page);
}

/**
 * El `<dialog>` ABIERTO que contiene el elemento dado. Crear/editar/borrar son
 * `<dialog>` nativos y `dialog[open]` puede matchear más de uno: el
 * discriminador es el contenido (la acción del formulario en los tres).
 */
function modalAbierto(page: Page, dentro: Locator): Locator {
	return page.locator('dialog[open]').filter({ has: dentro });
}

/** El modal de crear receta (`?/create`, nunca en edición). */
const modalCrear = (page: Page) => modalAbierto(page, page.locator('form[action="?/create"]'));

/** El modal de crear REUTILIZADO en edición (`?/update`). */
const modalEditar = (page: Page) => modalAbierto(page, page.locator('form[action="?/update"]'));

/** La confirmación de borrar (`?/delete`, patrón de familias y categorías). */
const modalBorrar = (page: Page) => modalAbierto(page, page.locator('form[action="?/delete"]'));

/** La fila del listado de UNA receta (por su nombre visible). */
const filaDe = (page: Page, nombre: string) => page.locator('li', { hasText: nombre });

test('crear con autocompletado: hereda la unidad, enlaza el producto y no crea nada en despensa', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	// La leche ya vive en la despensa con SU unidad: nombrarla en la receta
	// hereda la unidad y la ENLAZA; escribir una receta no es comprar.
	const leche = await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		normalizedName: 'leche entera',
		quantity: 2,
		unit: 'liter'
	});
	await seedSession(page, user);

	await openRecipes(page);

	// Sin recetas aún: el estado vacío con su CTA (y el botón de la cabecera,
	// que abre el mismo modal — dos botones con el mismo nombre).
	await expect(page.getByText('Todavía no hay recetas en esta familia.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Nueva receta' })).toHaveCount(2);

	await page.getByRole('button', { name: 'Nueva receta' }).first().click();
	const creacion = modalCrear(page);
	await expect(creacion.getByRole('heading', { name: 'Nueva receta' })).toBeVisible();

	// Nombre y raciones, y DOS ingredientes: la leche existe en despensa (la
	// unidad del select cambia SOLA a la del producto, L) y la nuez moscada es
	// inventada (su fila arranca y se queda en «ud»).
	await creacion.locator('#recipe-name').fill('Bechamel');
	await creacion.locator('#recipe-servings').fill('4');
	await expect(creacion.locator('#recipe-ingredient-unit-0')).toHaveValue('unit');
	await creacion.locator('#recipe-ingredient-name-0').fill('Leche entera');
	await expect(creacion.locator('#recipe-ingredient-unit-0')).toHaveValue('liter');
	await creacion.locator('#recipe-ingredient-quantity-0').fill('0.5');
	await creacion.getByRole('button', { name: 'Añadir ingrediente' }).click();
	await creacion.locator('#recipe-ingredient-name-1').fill('Nuez moscada');
	await expect(creacion.locator('#recipe-ingredient-unit-1')).toHaveValue('unit');

	await creacion.getByRole('button', { name: 'Nueva receta' }).click();

	// Éxito FUERA del modal: cierra el modal y avisa en la página, y el
	// listado (load pesimista) pinta la receta con su badge de raciones.
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Receta creada: ya aparece en la vista.');
	await expect(filaDe(page, 'Bechamel')).toBeVisible();
	await expect(page.getByText('Raciones: 4')).toBeVisible();

	// La verdad en la BD: receta con dos ingredientes en su orden, la leche
	// ENLAZADA a su producto (la FK viaja con el formulario) y la nuez
	// moscada SUELTA (nombre inventado, sin FK).
	const receta = await prisma.recipe.findFirstOrThrow({
		where: { organizationId: family.id, name: 'Bechamel' }
	});
	const ingredientes = await prisma.recipeIngredient.findMany({
		where: { recipeId: receta.id },
		orderBy: { position: 'asc' }
	});
	expect(ingredientes.map((row) => [row.name, Number(row.quantity), row.unit])).toEqual([
		['Leche entera', 0.5, 'liter'],
		['Nuez moscada', 1, 'unit']
	]);
	expect(ingredientes.map((row) => row.pantryItemId)).toEqual([leche.id, null]);

	// Y NADA se crea en despensa (decisión de fase 2): la leche sigue con sus
	// dos litros y la nuez moscada no existe.
	expect(await prisma.pantryItem.count()).toBe(1);
	const lecheTrasGuardar = await prisma.pantryItem.findUniqueOrThrow({ where: { id: leche.id } });
	expect(Number(lecheTrasGuardar.quantity)).toBe(2);
});

test('aviso de unidad conflictiva: propone la conversión exacta y la aplica al pulsar', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	// El arroz vive en la despensa en KILOS (tarea #240): teclearlo en otra
	// unidad ha de avisar y proponer la conversión cuando es exacta.
	const arroz = await createPantryItem({
		familyId: family.id,
		name: 'Arroz',
		normalizedName: 'arroz',
		quantity: 3,
		unit: 'kilogram'
	});
	await seedSession(page, user);

	await openRecipes(page);

	await page.getByRole('button', { name: 'Nueva receta' }).first().click();
	const creacion = modalCrear(page);

	// «arroz» en MINÚSCULAS: no casan los nombres visibles (no hereda la
	// unidad del autocompletado) y la fila va a mano — 300 g.
	await creacion.locator('#recipe-name').fill('Paella');
	await creacion.locator('#recipe-ingredient-name-0').fill('arroz');
	await creacion.locator('#recipe-ingredient-quantity-0').fill('300');
	await creacion.locator('#recipe-ingredient-unit-0').selectOption({ label: 'g' });

	// El chip avisa del conflicto (match por nombre canónico) y ofrece la
	// conversión exacta: «usar kg → 0,3 kg».
	await expect(creacion.getByText('está en la despensa en kg')).toBeVisible();
	const usarKg = creacion.getByRole('button', { name: 'usar kg → 0,3 kg' });
	await expect(usarKg).toBeVisible();

	// Pulsado: la fila adapta cantidad y unidad — y el chip desaparece, que
	// ya no hay conflicto.
	await usarKg.click();
	await expect(creacion.locator('#recipe-ingredient-quantity-0')).toHaveValue('0.3');
	await expect(creacion.locator('#recipe-ingredient-unit-0')).toHaveValue('kilogram');
	await expect(creacion.getByText('está en la despensa en kg')).toHaveCount(0);

	// Sin conversión posible (ud→docena, paquete…): el aviso informa SIN botón.
	await creacion.locator('#recipe-ingredient-unit-0').selectOption({ label: 'paquete' });
	await expect(creacion.getByText('está en la despensa en kg')).toBeVisible();
	await expect(creacion.getByRole('button', { name: /usar/ })).toHaveCount(0);

	// De vuelta al kilo del producto: el conflicto se esfuma y se guarda.
	await creacion.locator('#recipe-ingredient-unit-0').selectOption({ label: 'kg' });
	await expect(creacion.getByText('está en la despensa en kg')).toHaveCount(0);
	await creacion.getByRole('button', { name: 'Nueva receta' }).click();
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Receta creada: ya aparece en la vista.');

	// La verdad en la BD: 0,3 kg y ENLAZADO al producto de despensa (la
	// conversión enlaza, como el autocompletado de #239).
	const receta = await prisma.recipe.findFirstOrThrow({
		where: { organizationId: family.id, name: 'Paella' }
	});
	const ingredientes = await prisma.recipeIngredient.findMany({
		where: { recipeId: receta.id },
		orderBy: { position: 'asc' }
	});
	expect(ingredientes.map((row) => [row.name, Number(row.quantity), row.unit])).toEqual([
		['arroz', 0.3, 'kilogram']
	]);
	expect(ingredientes.map((row) => row.pantryItemId)).toEqual([arroz.id]);
});

test('editar precarga el modal, sustituye los ingredientes y acepta quitar las raciones', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const receta = await createRecipe({
		familyId: family.id,
		name: 'Tortilla de patatas',
		servings: 4,
		ingredients: [
			{ name: 'Huevos', quantity: 6, unit: 'unit' },
			{ name: 'Cebolla', quantity: 1, unit: 'kilogram' }
		]
	});
	await seedSession(page, user);

	await openRecipes(page);

	await filaDe(page, 'Tortilla de patatas').getByRole('button', { name: 'Editar receta' }).click();
	const edicion = modalEditar(page);
	await expect(edicion.getByRole('heading', { name: 'Editar receta' })).toBeVisible();
	await expect(edicion.locator('#recipe-name')).toHaveValue('Tortilla de patatas');
	await expect(edicion.locator('#recipe-servings')).toHaveValue('4');
	await expect(edicion.locator('#recipe-ingredient-name-0')).toHaveValue('Huevos');
	await expect(edicion.locator('#recipe-ingredient-quantity-0')).toHaveValue('6');
	await expect(edicion.locator('#recipe-ingredient-name-1')).toHaveValue('Cebolla');

	// Cambia el nombre, VACÍA las raciones (opcional: «ya no lo declara»),
	// quita la cebolla y añade pimentón al final.
	await edicion.locator('#recipe-name').fill('Tortilla francesa');
	await edicion.locator('#recipe-servings').fill('');
	await edicion
		.locator('div.bg-base-200')
		.filter({ has: page.locator('#recipe-ingredient-name-1') })
		.getByRole('button', { name: 'Quitar ingrediente' })
		.click();
	await edicion.getByRole('button', { name: 'Añadir ingrediente' }).click();
	await edicion.locator('#recipe-ingredient-name-1').fill('Pimentón dulce');
	await edicion.locator('#recipe-ingredient-quantity-1').fill('0.5');
	await edicion.locator('#recipe-ingredient-unit-1').selectOption({ label: 'g' });

	await edicion.getByRole('button', { name: 'Guardar cambios' }).click();

	// Éxito: el modal cierra, el aviso llega a la página y la fila repinta el
	// nombre nuevo SIN badge (las raciones se fueron con la edición).
	await expect(edicion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Receta actualizada.');
	await expect(filaDe(page, 'Tortilla francesa')).toBeVisible();
	await expect(filaDe(page, 'Tortilla de patatas')).toHaveCount(0);
	await expect(page.getByText('Raciones: 4')).toHaveCount(0);

	// La verdad en la BD: el canónico acompaña al nombre, las raciones son
	// `null` y la edición sustituye los ingredientes ENTERA (borra y crea con
	// la posición recalculada).
	const guardada = await prisma.recipe.findUniqueOrThrow({ where: { id: receta.id } });
	expect(guardada.name).toBe('Tortilla francesa');
	expect(guardada.normalizedName).toBe('tortilla francesa');
	expect(guardada.servings).toBeNull();
	const ingredientes = await prisma.recipeIngredient.findMany({
		where: { recipeId: receta.id },
		orderBy: { position: 'asc' }
	});
	expect(ingredientes.map((row) => [row.name, Number(row.quantity), row.unit])).toEqual([
		['Huevos', 6, 'unit'],
		['Pimentón dulce', 0.5, 'gram']
	]);
});

test('duplicado: el error se queda en el modal, sin nada en la BD, y el renombre salva', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createRecipe({ familyId: family.id, name: 'Lentejas guisadas' });
	await seedSession(page, user);

	await openRecipes(page);

	await page.getByRole('button', { name: 'Nueva receta' }).click();
	const creacion = modalCrear(page);
	await creacion.locator('#recipe-name').fill('Lentejas Guisadas');
	await creacion.locator('#recipe-ingredient-name-0').fill('Lentejas pardinas');

	// El nombre solo difiere en mayúsculas: el único (familia, nombre
	// normalizado) de la base lo rechaza y la UI lo traduce DENTRO del modal,
	// que sigue abierto. (El ingrediente ha de ser válido: si no, lo corta
	// antes el schema en cliente y el error de servidor no llega a verse.)
	await creacion.getByRole('button', { name: 'Nueva receta' }).click();
	await expect(
		creacion.getByText('Ya existe una receta con ese nombre en esta familia.')
	).toBeVisible();
	await expect(creacion.getByRole('heading', { name: 'Nueva receta' })).toBeVisible();
	expect(await prisma.recipe.count({ where: { organizationId: family.id } })).toBe(1);

	// El remedio — otro nombre — guarda.
	await creacion.locator('#recipe-name').fill('Lentejas rapidas');
	await creacion.getByRole('button', { name: 'Nueva receta' }).click();
	await expect(creacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Receta creada: ya aparece en la vista.');
	await expect(filaDe(page, 'Lentejas rapidas')).toBeVisible();
	expect(await prisma.recipe.count({ where: { organizationId: family.id } })).toBe(2);
});

test('borrar con confirmacion: fuera del listado y sin tocar despensa ni menús', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const arroz = await createPantryItem({
		familyId: family.id,
		name: 'Arroz',
		normalizedName: 'arroz',
		quantity: 3,
		unit: 'kilogram'
	});
	const risotto = await createRecipe({
		familyId: family.id,
		name: 'Risotto',
		ingredients: [{ name: 'Arroz', quantity: 300, unit: 'gram', pantryItemId: arroz.id }]
	});
	const sopa = await createRecipe({ familyId: family.id, name: 'Sopa de fideos' });
	// Un menú NACIDO de la receta (recipeId apuntándole, como deja el alta de
	// la #242): borrar la receta debe dejar el menú en pie, con su FK en null
	// (SetNull) — el snapshot vive solo.
	const menu = await createMealPlan({
		familyId: family.id,
		dateKey: '2026-03-10',
		mealType: 'lunch'
	});
	await prisma.mealPlan.update({ where: { id: menu.id }, data: { recipeId: risotto.id } });
	await seedSession(page, user);

	await openRecipes(page);

	// Las DOS recetas conviven en el listado, alfabéticas.
	await expect(filaDe(page, 'Risotto')).toBeVisible();
	await expect(filaDe(page, 'Sopa de fideos')).toBeVisible();

	await filaDe(page, 'Risotto').getByRole('button', { name: 'Borrar receta' }).click();
	const confirmacion = modalBorrar(page);
	await expect(confirmacion.getByRole('heading', { name: '¿Borrar «Risotto»?' })).toBeVisible();
	await confirmacion.getByRole('button', { name: 'Borrar definitivamente' }).click();

	// Confirmado: aviso en la página, fuera del listado y de la BD…
	await expect(confirmacion).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Receta borrada.');
	await expect(filaDe(page, 'Risotto')).toHaveCount(0);
	await expect(filaDe(page, 'Sopa de fideos')).toBeVisible();
	await expect(prisma.recipe.findUnique({ where: { id: risotto.id } })).resolves.toBeNull();
	// La otra receta, ni se inmuta.
	await expect(prisma.recipe.findUnique({ where: { id: sopa.id } })).resolves.not.toBeNull();

	// …la despensa NO cambia (el arroz sigue con sus tres kilos)…
	expect(await prisma.pantryItem.count()).toBe(1);
	const arrozTrasBorrar = await prisma.pantryItem.findUniqueOrThrow({ where: { id: arroz.id } });
	expect(Number(arrozTrasBorrar.quantity)).toBe(3);

	// …y el menú nacido de la receta vive solo: sigue en pie, con su FK a
	// null y SU snapshot de ingredientes.
	const menuTrasBorrar = await prisma.mealPlan.findUniqueOrThrow({ where: { id: menu.id } });
	expect(menuTrasBorrar.recipeId).toBeNull();
	expect(menuTrasBorrar.title).toBe(menu.title);
});

test('el filtro busca por nombre en cliente, avisa sin resultados y se limpia', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createRecipe({ familyId: family.id, name: 'Tortilla de patatas' });
	await createRecipe({ familyId: family.id, name: 'Lentejas con verduras' });
	await createRecipe({ familyId: family.id, name: 'Tortilla francesa' });
	await seedSession(page, user);

	await openRecipes(page);

	// Las tres, alfabéticas por el nombre VISIBLE (el orden lo trae el load).
	const filas = page.locator('section > ul > li');
	await expect(filas).toHaveText([
		/Lentejas con verduras/,
		/Tortilla de patatas/,
		/Tortilla francesa/
	]);

	// «tortilla» (minúsculas): quedan las dos tortillas, la lentejas fuera —
	// el match normaliza los lados, como en la despensa.
	await page.locator('#item-search').fill('tortilla');
	await expect(filas).toHaveText([/Tortilla de patatas/, /Tortilla francesa/]);
	await expect(filaDe(page, 'Lentejas con verduras')).toHaveCount(0);

	// Sin resultados: el aviso del buscador, no el estado vacío de la familia.
	await page.locator('#item-search').fill('zzz');
	await expect(page.getByText('Ningún artículo coincide con la búsqueda.')).toBeVisible();
	await expect(filas).toHaveCount(0);

	// Limpiar: vuelven las tres.
	await page.getByRole('button', { name: 'Limpiar la búsqueda' }).click();
	await expect(filas).toHaveText([
		/Lentejas con verduras/,
		/Tortilla de patatas/,
		/Tortilla francesa/
	]);
});
