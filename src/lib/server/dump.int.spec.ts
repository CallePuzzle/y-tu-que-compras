import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): el volcado a la lista
// de compra (`#lib/server/dump.ts`, tarea #245) contra un Postgres real con
// las migraciones aplicadas. Como en `pantry.int.spec.ts`, las familias de
// prueba se crean directamente con Prisma y los menús con `createMealPlan`
// (el servidor, que garantiza y enlaza la despensa de cada ingrediente); lo
// que se ejercita es la transacción entera — el lock de la lista, el déficit
// recalculado con `dayPantryStatus` y el buscar-equivalente-o-crear del
// patrón `readdPantryItem` — sin pasar por la vista.
import prisma from './prisma.js';
import { dumpDayToList } from './dump.js';
import { createCategory } from './categories.js';
import { createList } from './lists.js';
import { createMealPlan } from './mealplans.js';
import type { MealPlanData } from './mealplans.js';

/** Crea una familia directamente en la base y devuelve su id. */
async function familyRow(prefix: string): Promise<string> {
	const id = randomUUID();
	await prisma.organization.create({
		data: {
			id,
			name: `${prefix} ${id.slice(0, 8)}`,
			// El formato de `slug` lo exige el plugin (^[a-z0-9-]+$, máx 50); aquí
			// solo hace falta cumplirlo para la FK.
			slug: `familia-${id.slice(0, 13).toLowerCase()}`
		}
	});
	return id;
}

/** Siembra un producto de despensa (lo que deja `finalizePurchase`). */
async function pantryRow(
	familyId: string,
	name: string,
	quantity: number,
	unit: Parameters<typeof prisma.pantryItem.create>[0]['data']['unit']
) {
	return prisma.pantryItem.create({
		data: {
			organizationId: familyId,
			name,
			normalizedName: name
				.trim()
				.normalize('NFD')
				.replace(/\p{Diacritic}/gu, '')
				.toLowerCase(),
			quantity,
			unit
		}
	});
}

/** Un menú del día 10 de marzo de 2026 (los tests fijan la despensa aparte). */
function mealWith(
	familyId: string,
	mealType: MealPlanData['mealType'],
	title: string,
	ingredients: MealPlanData['ingredients'],
	pantryIds: Array<string | null>
) {
	return createMealPlan(familyId, {
		date: '2026-03-10',
		mealType,
		title,
		ingredients
	}).then(async (meal) => {
		// Los enlaces que el test decide: `createMealPlan` garantiza producto
		// para TODOS los ingredientes; un `null` aquí simula el SetNull del
		// borrado posterior del producto de despensa.
		for (const [position, pantryId] of pantryIds.entries()) {
			if (pantryId === null) {
				await prisma.mealPlanIngredient.updateMany({
					where: { mealPlanId: meal.id, position },
					data: { pantryItemId: null }
				});
			}
		}
		return meal;
	});
}

/** Datos válidos según `listSchema`, para crear las listas de prueba. */
const LIST = { name: 'Compra semanal', color: 'yellow', icon: 'shopping-basket' } as const;

/** El volcado del día 10 de marzo a la lista dada. */
function dumpDay(familyId: string, listId: string) {
	return dumpDayToList(familyId, { date: '2026-03-10', listId });
}

async function itemsOf(listId: string) {
	return prisma.item.findMany({ where: { listId }, orderBy: { order: 'asc' } });
}

describe('Volcado del día (#245)', () => {
	it('crea el item con el déficit exacto, heredando nombre y categoría del producto de despensa', async () => {
		const familyId = await familyRow('Familia Volcadora');
		const list = await createList(familyId, LIST);
		const dairy = await createCategory(familyId, { name: 'Lácteos' });
		// La despensa pone el nombre visible y la categoría; el menú pide 1,5 L.
		const leche = await pantryRow(familyId, 'Leche entera', 1, 'liter');
		await prisma.pantryItem.update({ where: { id: leche.id }, data: { categoryId: dairy.id } });
		await mealWith(
			familyId,
			'lunch',
			'Congrí',
			[{ name: 'Leche entera', quantity: 1.5, unit: 'liter' }],
			[leche.id]
		);
		// Un item ya existente para comprobar que el nuevo va DETRÁS (order 1).
		await prisma.item.create({
			data: { listId: list.id, name: 'Pan', quantity: 1, unit: 'unit', order: 0 }
		});

		const result = await dumpDay(familyId, list.id);

		expect(result).toEqual({
			outcome: 'added',
			items: [{ name: 'Leche entera', quantity: 0.5, unit: 'liter' }]
		});
		const rows = await itemsOf(list.id);
		expect(rows).toHaveLength(2);
		expect(rows[1]).toMatchObject({
			name: 'Leche entera',
			unit: 'liter',
			categoryId: dairy.id,
			purchased: false,
			order: 1
		});
		expect(Number(rows[1].quantity)).toBe(0.5);
	});

	it('agrega la necesidad de las dos comidas ANTES de comparar con la despensa', async () => {
		const familyId = await familyRow('Familia Agregadora');
		const list = await createList(familyId, LIST);
		const huevos = await pantryRow(familyId, 'Huevos', 10, 'unit');
		await mealWith(
			familyId,
			'lunch',
			'Tortilla',
			[{ name: 'Huevos', quantity: 6, unit: 'unit' }],
			[huevos.id]
		);
		await mealWith(
			familyId,
			'dinner',
			'Revuelto',
			[{ name: 'Huevos', quantity: 6, unit: 'unit' }],
			[huevos.id]
		);

		// 6 + 6 contra 10: por comidas sueltas no faltaría nada en ninguna;
		// agregadas falta 2 — UNA línea, no dos.
		const result = await dumpDay(familyId, list.id);
		expect(result).toEqual({
			outcome: 'added',
			items: [{ name: 'Huevos', quantity: 2, unit: 'unit' }]
		});
		const rows = await itemsOf(list.id);
		expect(rows).toHaveLength(1);
		expect(Number(rows[0].quantity)).toBe(2);
		// La despensa NO se toca: el volcado escribe en la lista, como el
		// re-añadido (#149).
		const pantry = await prisma.pantryItem.findUniqueOrThrow({ where: { id: huevos.id } });
		expect(Number(pantry.quantity)).toBe(10);
	});

	it('el volcado individual añade el déficit AGREGADO del día de su producto, no solo su comida', async () => {
		const familyId = await familyRow('Familia Individual');
		const list = await createList(familyId, LIST);
		const huevos = await pantryRow(familyId, 'Huevos', 10, 'unit');
		const lunch = await mealWith(
			familyId,
			'lunch',
			'Tortilla',
			[{ name: 'Huevos', quantity: 6, unit: 'unit' }],
			[huevos.id]
		);
		await mealWith(
			familyId,
			'dinner',
			'Revuelto',
			[{ name: 'Huevos', quantity: 6, unit: 'unit' }],
			[huevos.id]
		);
		const ingredient = await prisma.mealPlanIngredient.findFirstOrThrow({
			where: { mealPlanId: lunch.id }
		});

		// El ingrediente de la COMIDA dispara el déficit del DÍA: 12 − 10 = 2,
		// exactamente lo que enseña su badge (#244).
		const result = await dumpDayToList(familyId, {
			date: '2026-03-10',
			listId: list.id,
			ingredientId: ingredient.id
		});
		expect(result).toEqual({
			outcome: 'added',
			items: [{ name: 'Huevos', quantity: 2, unit: 'unit' }]
		});
		await expect(itemsOf(list.id)).resolves.toHaveLength(1);
	});

	it('suma sobre el pendiente equivalente (mismo nombre normalizado y unidad), sin duplicar', async () => {
		const familyId = await familyRow('Familia Sumadora Volcado');
		const list = await createList(familyId, LIST);
		const leche = await pantryRow(familyId, 'Leche entera', 1, 'liter');
		await mealWith(
			familyId,
			'lunch',
			'Papelillo',
			[{ name: 'Leche entera', quantity: 1.5, unit: 'liter' }],
			[leche.id]
		);
		// Escrito distinto («leche ENTERA») pero mismo producto canónico.
		const pending = await prisma.item.create({
			data: { listId: list.id, name: 'leche ENTERA', quantity: 0.5, unit: 'liter', order: 0 }
		});

		await dumpDay(familyId, list.id);

		// Una sola fila: se sumó sobre la existente (0,5 + 0,5 = 1 L), con su
		// nombre escrito conservado.
		const rows = await itemsOf(list.id);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(pending.id);
		expect(rows[0].name).toBe('leche ENTERA');
		expect(Number(rows[0].quantity)).toBe(1);
	});

	it('los ingredientes sin producto de despensa se vuelcan con su propio snapshot', async () => {
		const familyId = await familyRow('Familia Sin Fk');
		const list = await createList(familyId, LIST);
		const spices = await createCategory(familyId, { name: 'Especias' });
		const pimenton = await mealWith(
			familyId,
			'dinner',
			'Pimentón aparte',
			[{ name: 'Pimentón dulce', quantity: 1, unit: 'unit' }],
			[null]
		);
		// Con el producto ya borrado (SetNull), la categoría la conserva el
		// snapshot del INGREDIENTE: el item hereda de ahí.
		await prisma.mealPlanIngredient.updateMany({
			where: { mealPlanId: pimenton.id },
			data: { categoryId: spices.id }
		});

		const result = await dumpDay(familyId, list.id);

		expect(result).toEqual({
			outcome: 'added',
			items: [{ name: 'Pimentón dulce', quantity: 1, unit: 'unit' }]
		});
		const rows = await itemsOf(list.id);
		expect(rows[0]).toMatchObject({
			name: 'Pimentón dulce',
			unit: 'unit',
			categoryId: spices.id,
			purchased: false,
			order: 0
		});
	});

	it('déficit 0 sale como «nothing» sin escribir nada', async () => {
		const familyId = await familyRow('Familia Cubierta');
		const list = await createList(familyId, LIST);
		const huevos = await pantryRow(familyId, 'Huevos', 12, 'unit');
		await mealWith(
			familyId,
			'lunch',
			'Tortilla',
			[{ name: 'Huevos', quantity: 6, unit: 'unit' }],
			[huevos.id]
		);
		await mealWith(
			familyId,
			'dinner',
			'Revuelto',
			[{ name: 'Huevos', quantity: 6, unit: 'unit' }],
			[huevos.id]
		);

		await expect(dumpDay(familyId, list.id)).resolves.toEqual({ outcome: 'nothing' });
		await expect(itemsOf(list.id)).resolves.toHaveLength(0);
	});

	it('una lista ajena o un ingrediente de otro día no se dejan tocar', async () => {
		const ownFamily = await familyRow('Familia Volcado Propia');
		const otherFamily = await familyRow('Familia Volcado Ajena');
		const otherList = await createList(otherFamily, LIST);
		const ownList = await createList(ownFamily, LIST);
		const leche = await pantryRow(ownFamily, 'Leche entera', 1, 'liter');
		const caviarFamily = await pantryRow(otherFamily, 'Caviar', 1, 'unit');
		await mealWith(
			ownFamily,
			'lunch',
			'Merengue',
			[{ name: 'Leche entera', quantity: 1.5, unit: 'liter' }],
			[leche.id]
		);
		const foreignMeal = await mealWith(
			otherFamily,
			'dinner',
			'Aperitivo',
			[{ name: 'Caviar', quantity: 1, unit: 'unit' }],
			[caviarFamily.id]
		);
		const foreignIngredient = await prisma.mealPlanIngredient.findFirstOrThrow({
			where: { mealPlanId: foreignMeal.id }
		});

		// La lista ajena no es destino válido: «no existe», y nada se movió.
		await expect(dumpDay(ownFamily, otherList.id)).resolves.toEqual({ outcome: 'list-gone' });
		await expect(itemsOf(otherList.id)).resolves.toHaveLength(0);

		// El ingrediente AJENO (de la despensa y el menú de otra familia) es
		// «ya no está en el día»: sin revelar si vive en otra parte, sin
		// escribir nada.
		await expect(
			dumpDayToList(ownFamily, {
				date: '2026-03-10',
				listId: ownList.id,
				ingredientId: foreignIngredient.id
			})
		).resolves.toEqual({ outcome: 'ingredient-gone' });
		await expect(itemsOf(ownList.id)).resolves.toHaveLength(0);
	});
});

// ---- Concurrencia del volcado (issue #108, patrón `readdPantryItem`): dos
// miembros a la vez sobre la MISMA lista. Sin el lock de la fila de lista,
// el «buscar pendiente equivalente o crear» duplicaría items; con el lock,
// el segundo ve lo que el primero acaba de crear y suma — el déficit del día
// no cambia entre los dos (el volcado no toca la despensa), así que la suma
// es la doble del déficit. ----

describe('Volcados concurrentes (#245)', () => {
	it('volcado del día y volcado individual a la vez: un item con la suma', async () => {
		const familyId = await familyRow('Familia Volcada a la Vez');
		const list = await createList(familyId, LIST);
		const huevos = await pantryRow(familyId, 'Huevos', 10, 'unit');
		const lunch = await mealWith(
			familyId,
			'lunch',
			'Tortilla',
			[{ name: 'Huevos', quantity: 6, unit: 'unit' }],
			[huevos.id]
		);
		await mealWith(
			familyId,
			'dinner',
			'Revuelto',
			[{ name: 'Huevos', quantity: 6, unit: 'unit' }],
			[huevos.id]
		);
		const ingredient = await prisma.mealPlanIngredient.findFirstOrThrow({
			where: { mealPlanId: lunch.id }
		});

		const results = await Promise.all([
			dumpDay(familyId, list.id),
			dumpDayToList(familyId, {
				date: '2026-03-10',
				listId: list.id,
				ingredientId: ingredient.id
			})
		]);
		expect(results.map((result) => result.outcome)).toEqual(['added', 'added']);

		// UNA fila (la primera creó, la segunda sumó sobre ella): sin
		// duplicados y con 2 + 2 = 4 ud.
		const rows = await itemsOf(list.id);
		expect(rows).toHaveLength(1);
		expect(Number(rows[0].quantity)).toBe(4);
		expect(rows[0].purchased).toBe(false);
	});
});
