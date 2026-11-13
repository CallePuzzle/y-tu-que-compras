import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): las funciones de
// `#lib/server/mealplans.ts` contra un Postgres real con las migraciones
// aplicadas. Como en `items.int.spec.ts` no hacen falta sesiones: las
// familias de prueba se crean directamente con Prisma (el plugin de tenancy
// no entra en el camino) y lo que se ejercita es el CRUD de menús con el
// filtro de familia activa — los criterios de aceptación de la tarea #225:
// un miembro no toca menús de otra familia, el duplicado día+tipo sale como
// error controlado, el producto nuevo aparece en la despensa con cantidad 0,
// borrar el producto de despensa deja el ingrediente intacto (SetNull) y la
// edición reemplaza los ingredientes entera.
import prisma from './prisma.js';
import { createCategory } from './categories.js';
import type { MealPlanData } from './mealplans.js';
import {
	MealPlanExistsError,
	createMealPlan,
	deleteMealPlan,
	listMealPlans,
	updateMealPlan
} from './mealplans.js';

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

/** Datos válidos de menú, para mutar campo a campo en cada spec. */
const LENTES: MealPlanData = {
	date: '2026-03-10',
	mealType: 'lunch',
	title: 'Lentejas con verduras',
	ingredients: [
		{ name: 'Lentejas pardinas', quantity: 0.5, unit: 'kilogram' },
		{ name: 'Cebolla', quantity: 2, unit: 'unit' }
	]
};

describe('CRUD de menús por familia (#225)', () => {
	it('createMealPlan guarda fecha, tipo, título e ingredientes con posición del servidor', async () => {
		const familyId = await familyRow('Familia Menuera');

		const meal = await createMealPlan(familyId, LENTES);
		expect(meal).toMatchObject({ mealType: 'lunch', title: 'Lentejas con verduras' });
		// La fecha es pura (`@db.Date`): medianoche UTC del día del formulario.
		expect(meal.date.toISOString()).toBe('2026-03-10T00:00:00.000Z');
		// Los Decimals de la base se leen como number para la vista.
		expect(meal.ingredients.map((ingredient) => [ingredient.name, ingredient.quantity])).toEqual([
			['Lentejas pardinas', 0.5],
			['Cebolla', 2]
		]);

		// La posición la fija el SERVIDOR (el schema no trae default): el orden
		// del formulario, desde 0.
		const rows = await prisma.mealPlanIngredient.findMany({
			where: { mealPlanId: meal.id },
			orderBy: { position: 'asc' }
		});
		expect(rows.map((row) => row.position)).toEqual([0, 1]);
	});

	it('createMealPlan rechaza el duplicado día+tipo de la familia; otro tipo, otro día u otra familia no', async () => {
		const ownFamily = await familyRow('Familia Repetida');
		const otherFamily = await familyRow('Familia Otra');
		await createMealPlan(ownFamily, LENTES);

		// El único (familia, fecha, tipo) lo rechaza y sale como el error de
		// dominio que la acción traducirá al mensaje genérico de la UI (#225).
		await expect(createMealPlan(ownFamily, LENTES)).rejects.toBeInstanceOf(MealPlanExistsError);

		// El duplicado exige el PAR exacto: otro tipo de comida el mismo día cabe.
		await expect(
			createMealPlan(ownFamily, { ...LENTES, mealType: 'dinner' })
		).resolves.toBeDefined();
		// Otro día con el mismo tipo también.
		await expect(
			createMealPlan(ownFamily, { ...LENTES, date: '2026-03-11' })
		).resolves.toBeDefined();
		// Y en OTRA familia el mismo día y tipo es válido.
		await expect(createMealPlan(otherFamily, LENTES)).resolves.toBeDefined();
	});

	it('un menú sin ingredientes se guarda sin tocar la despensa', async () => {
		const familyId = await familyRow('Familia Ligera');

		const meal = await createMealPlan(familyId, { ...LENTES, ingredients: [] });

		expect(meal.ingredients).toEqual([]);
		expect(await prisma.pantryItem.findMany({ where: { organizationId: familyId } })).toHaveLength(
			0
		);
	});

	it('guardar el menú garantiza la despensa: producto nuevo con cantidad 0 y la categoría del ingrediente', async () => {
		const familyId = await familyRow('Familia Despensera');
		const lacteos = await createCategory(familyId, { name: 'Lácteos' });

		const meal = await createMealPlan(familyId, {
			...LENTES,
			ingredients: [{ name: 'Leche Entera', quantity: 1, unit: 'liter', categoryId: lacteos.id }]
		});

		const pantry = await prisma.pantryItem.findUniqueOrThrow({
			where: {
				organizationId_normalizedName_unit: {
					organizationId: familyId,
					// El canónico lo calcula el SERVIDOR con el mismo
					// `normalizeItemName` de la despensa: minúsculas, sin acentos y
					// espacios colapsados.
					normalizedName: 'leche entera',
					unit: 'liter'
				}
			}
		});
		// El producto nuevo aparece en la despensa con cantidad 0 (criterio de
		// aceptación): el menú garantiza el producto, no lo compra.
		expect(Number(pantry.quantity)).toBe(0);
		expect(pantry.name).toBe('Leche Entera');
		expect(pantry.categoryId).toBe(lacteos.id);
		// El ingrediente queda enlazado al producto garantizado.
		expect(meal.ingredients[0]?.pantryItemId).toBe(pantry.id);
	});

	it('dos ingredientes del mismo producto enlanzan a UN producto de despensa', async () => {
		const familyId = await familyRow('Familia Repetidora');
		const frutas = await createCategory(familyId, { name: 'Frutas' });

		const meal = await createMealPlan(familyId, {
			...LENTES,
			ingredients: [
				{ name: 'Plátano de Canarias', quantity: 3, unit: 'unit' },
				{ name: 'plátano de canarias', quantity: 6, unit: 'unit', categoryId: frutas.id }
			]
		});

		// «Plátano de Canarias» y «plátano de canarias» son el mismo producto:
		// un solo aterrizaje (el nombre visible es el del primero) y la
		// categoría, la del primero que la lleva.
		const pantry = await prisma.pantryItem.findMany({ where: { organizationId: familyId } });
		expect(pantry).toHaveLength(1);
		expect(pantry[0]).toMatchObject({
			name: 'Plátano de Canarias',
			normalizedName: 'platano de canarias',
			categoryId: frutas.id
		});
		const linkedIds = meal.ingredients.map((ingredient) => ingredient.pantryItemId);
		expect(linkedIds[0]).toBe(pantry[0]?.id);
		expect(linkedIds[1]).toBe(pantry[0]?.id);
	});

	it('un producto que ya estaba no cambia de cantidad; su categoría solo hereda si estaba sin ella', async () => {
		const familyId = await familyRow('Familia Acumulada');
		const vieja = await createCategory(familyId, { name: 'Antigua' });
		const nueva = await createCategory(familyId, { name: 'Nueva' });
		const panaderia = await createCategory(familyId, { name: 'Panadería' });

		// La despensa que dejaron las compras: leche con cantidad Y categoría
		// propias, pan con cantidad pero SIN categoría.
		const leche = await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Leche entera',
				normalizedName: 'leche entera',
				quantity: 3,
				unit: 'liter',
				categoryId: vieja.id
			}
		});
		await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Pan',
				normalizedName: 'pan',
				quantity: 2,
				unit: 'unit'
			}
		});

		const meal = await createMealPlan(familyId, {
			...LENTES,
			ingredients: [
				{ name: 'LECHE  Entera', quantity: 1, unit: 'liter', categoryId: nueva.id },
				{ name: '  PAN  ', quantity: 1, unit: 'unit', categoryId: panaderia.id }
			]
		});

		// La categoría EXISTENTE siempre gana (épica #175, como al finalizar una
		// compra) y la cantidad no se toca: el menú no suma ni resta.
		const afterLeche = await prisma.pantryItem.findUniqueOrThrow({ where: { id: leche.id } });
		expect(Number(afterLeche.quantity)).toBe(3);
		expect(afterLeche.categoryId).toBe(vieja.id);
		// El enlace va al producto canónico aunque el nombre llegue variado
		// (mayúsculas y espacios de más: mismo `normalizedName`).
		expect(meal.ingredients[0]?.pantryItemId).toBe(leche.id);

		// El que estaba SIN categoría hereda la del ingrediente (el nombre
		// llega con mayúsculas y espacios de más: mismo `normalizedName`), sin
		// cambiar de cantidad.
		const pan = await prisma.pantryItem.findFirstOrThrow({
			where: { organizationId: familyId, normalizedName: 'pan' }
		});
		expect(Number(pan.quantity)).toBe(2);
		expect(pan.categoryId).toBe(panaderia.id);
	});

	it('updateMealPlan reemplaza los ingredientes entera y actualiza el resto de campos', async () => {
		const familyId = await familyRow('Familia Editora de Menús');
		const meal = await createMealPlan(familyId, LENTES);

		const edited = await updateMealPlan(familyId, meal.id, {
			...LENTES,
			title: 'Lentejas rápidas',
			date: '2026-03-12',
			ingredients: [{ name: 'Lentejas pardinas', quantity: 0.3, unit: 'kilogram' }]
		});
		expect(edited).toBe(true);

		// La cebolla de la primera edición NO sobrevive: el reemplazo es entero,
		// como `updateItem` sustituye los campos.
		const rows = await prisma.mealPlanIngredient.findMany({
			where: { mealPlanId: meal.id },
			orderBy: { position: 'asc' }
		});
		expect(rows.map((row) => row.name)).toEqual(['Lentejas pardinas']);
		expect(rows[0]?.position).toBe(0);
		expect(Number(rows[0]?.quantity)).toBe(0.3);

		const row = await prisma.mealPlan.findUniqueOrThrow({ where: { id: meal.id } });
		expect(row.title).toBe('Lentejas rápidas');
		expect(row.date.toISOString()).toBe('2026-03-12T00:00:00.000Z');
	});

	it('updateMealPlan no toca un menú de otra familia o inexistente', async () => {
		const ownFamily = await familyRow('Familia Propia');
		const otherFamily = await familyRow('Familia Intacta');
		const ownMeal = await createMealPlan(ownFamily, LENTES);
		const foreignMeal = await createMealPlan(otherFamily, LENTES);

		// El id de un menú de OTRA familia no se puede editar aunque se conozca.
		expect(await updateMealPlan(ownFamily, foreignMeal.id, { ...LENTES, title: 'Vándalo' })).toBe(
			false
		);
		expect((await prisma.mealPlan.findUniqueOrThrow({ where: { id: foreignMeal.id } })).title).toBe(
			LENTES.title
		);

		// Igual con un id inexistente.
		expect(await updateMealPlan(ownFamily, randomUUID(), LENTES)).toBe(false);
		// Y la edición fallida no tocó el propio.
		expect((await prisma.mealPlan.findUniqueOrThrow({ where: { id: ownMeal.id } })).title).toBe(
			LENTES.title
		);
	});

	it('mover un menú a un día+tipo ocupado sale como error controlado, sin dejar nada a medias', async () => {
		const familyId = await familyRow('Familia Replanificadora');
		const martes = await createMealPlan(familyId, LENTES);
		const miercoles = await createMealPlan(familyId, {
			...LENTES,
			date: '2026-03-11',
			title: 'Garbanzos'
		});

		// El miércoles pasa al martes… pero el martes ya tiene ese almuerzo:
		// el único (familia, fecha, tipo) lo rechaza como el alta.
		await expect(
			updateMealPlan(familyId, miercoles.id, { ...LENTES, date: '2026-03-10' })
		).rejects.toBeInstanceOf(MealPlanExistsError);

		// El rechazo revierte TODO: el menú sigue en SU día con sus ingredientes
		// originales y sin productos nuevos en la despensa.
		const intact = await prisma.mealPlan.findUniqueOrThrow({
			where: { id: miercoles.id },
			include: { ingredients: true }
		});
		expect(intact.title).toBe('Garbanzos');
		expect(intact.date.toISOString()).toBe('2026-03-11T00:00:00.000Z');
		expect(intact.ingredients).toHaveLength(2);

		// Editar sin mover no choca consigo mismo: Postgres ignora el update que
		// no cambia los valores de la fila.
		expect(
			await updateMealPlan(familyId, miercoles.id, {
				...LENTES,
				date: '2026-03-11',
				title: 'Garbanzos con espinacas'
			})
		).toBe(true);
		// El martes quedó fuera de la maniobra.
		expect((await prisma.mealPlan.findUniqueOrThrow({ where: { id: martes.id } })).title).toBe(
			LENTES.title
		);
	});

	it('la categoría del ingrediente ajena o rancia se guarda como «sin categoría», sin 500', async () => {
		const ownFamily = await familyRow('Familia Categorizadora');
		const otherFamily = await familyRow('Familia Ajena Categorial');
		const foreign = await createCategory(otherFamily, { name: 'Ajena' });

		const meal = await createMealPlan(ownFamily, {
			...LENTES,
			ingredients: [
				// El id de UNA categoría de OTRA familia…
				{ name: 'Cebolla', quantity: 2, unit: 'unit', categoryId: foreign.id },
				// …y un id que ya no existe (rancio): mismo efecto que el SetNull.
				{ name: 'Ajo', quantity: 1, unit: 'unit', categoryId: randomUUID() }
			]
		});

		// Ninguno rompe la FK: el servidor los degrada a «sin categoría».
		const rows = await prisma.mealPlanIngredient.findMany({
			where: { mealPlanId: meal.id },
			orderBy: { position: 'asc' }
		});
		expect(rows.map((row) => row.categoryId)).toEqual([null, null]);
		// La despensa garantizada tampoco hereda una categoría ajena.
		const pantry = await prisma.pantryItem.findMany({ where: { organizationId: ownFamily } });
		expect(pantry).toHaveLength(2);
		expect(pantry.every((product) => product.categoryId === null)).toBe(true);
	});

	it('un día inexistente se rechaza de verdad: el parseo ISO hace rollover, no invalida', async () => {
		const familyId = await familyRow('Familia Calendarista');

		// «31 de febrero» es para `new Date(...)` el 3 de marzo: sin el
		// round-trip el menú se guardaría en un día distinto al elegido (y a
		// veces en otro mes del calendario).
		await expect(createMealPlan(familyId, { ...LENTES, date: '2026-02-31' })).rejects.toThrow(
			RangeError
		);
		await expect(createMealPlan(familyId, { ...LENTES, date: '2026-13-01' })).rejects.toThrow(
			RangeError
		);

		// La defensa va DENTRO de la transacción: la fecha se valida al
		// componer el INSERT y el rechazo revierte también la despensa que
		// `prepareIngredients` ya había garantizado.
		expect(await prisma.mealPlan.findMany({ where: { organizationId: familyId } })).toHaveLength(0);
		expect(await prisma.pantryItem.findMany({ where: { organizationId: familyId } })).toHaveLength(
			0
		);
	});

	it('deleteMealPlan borra el propio con sus ingredientes; uno ajeno devuelve false y queda', async () => {
		const ownFamily = await familyRow('Familia Borradora');
		const otherFamily = await familyRow('Familia Superviviente');
		const ownMeal = await createMealPlan(ownFamily, LENTES);
		const foreignMeal = await createMealPlan(otherFamily, LENTES);

		// El ajeno no se puede borrar aunque se conozca su id…
		expect(await deleteMealPlan(ownFamily, foreignMeal.id)).toBe(false);
		expect(await prisma.mealPlan.findUnique({ where: { id: foreignMeal.id } })).not.toBeNull();
		expect(await deleteMealPlan(ownFamily, randomUUID())).toBe(false);

		// …y el propio sí, llevándose sus ingredientes en cascada. La despensa
		// NO se toca: los productos garantizados siguen siendo de la familia.
		expect(await deleteMealPlan(ownFamily, ownMeal.id)).toBe(true);
		expect(await prisma.mealPlan.findUnique({ where: { id: ownMeal.id } })).toBeNull();
		expect(
			await prisma.mealPlanIngredient.findMany({ where: { mealPlanId: ownMeal.id } })
		).toHaveLength(0);
		expect(await prisma.pantryItem.findMany({ where: { organizationId: ownFamily } })).toHaveLength(
			2
		);
	});

	it('borrar el producto de despensa deja el ingrediente intacto (SetNull)', async () => {
		const familyId = await familyRow('Familia Sin Producto');
		const meal = await createMealPlan(familyId, {
			...LENTES,
			ingredients: [{ name: 'Cebolla', quantity: 2, unit: 'unit' }]
		});
		const ingredient = await prisma.mealPlanIngredient.findFirstOrThrow({
			where: { mealPlanId: meal.id }
		});
		const pantryId = ingredient.pantryItemId;
		if (!pantryId) {
			throw new Error('El ingrediente debía quedar enlazado a su producto de despensa');
		}

		await prisma.pantryItem.delete({ where: { id: pantryId } });

		// El snapshot sigue: nombre, cantidad y unidad viven en el ingrediente;
		// solo la referencia desaparece (el efecto del `SetNull` de la FK).
		const after = await prisma.mealPlanIngredient.findUniqueOrThrow({
			where: { id: ingredient.id }
		});
		expect(after).toMatchObject({ name: 'Cebolla', unit: 'unit', pantryItemId: null });
		expect(Number(after.quantity)).toBe(2);
	});

	it('borrar la familia se lleva sus menús y sus ingredientes (FK en cascada)', async () => {
		const familyId = await familyRow('Familia Evanescente');
		const meal = await createMealPlan(familyId, LENTES);

		await prisma.organization.delete({ where: { id: familyId } });

		expect(await prisma.mealPlan.findMany({ where: { organizationId: familyId } })).toHaveLength(0);
		expect(
			await prisma.mealPlanIngredient.findMany({ where: { mealPlanId: meal.id } })
		).toHaveLength(0);
	});
});

describe('Consulta mensual agrupada por día (#225)', () => {
	it('listMealPlans agrupa por día con la clave de celda del grid, solo de la familia y solo del mes', async () => {
		const ownFamily = await familyRow('Familia Calendárica');
		const otherFamily = await familyRow('Familia Ajena');

		const almuerzo = await createMealPlan(ownFamily, LENTES);
		// Dos menús el MISMO día: el orden natural los pone antes del almuerzo.
		const desayuno = await createMealPlan(ownFamily, {
			...LENTES,
			mealType: 'breakfast',
			title: 'Tostadas con tomate'
		});
		// El secreto de la otra familia NO puede asomar por el mismo día.
		await createMealPlan(otherFamily, { ...LENTES, title: 'Menú ajeno' });
		// Fuera del mes en vista: el último día del mes anterior y el primero
		// del siguiente — el rango es de fechas puras, sin horas que desplacen.
		await createMealPlan(ownFamily, { ...LENTES, date: '2026-02-28', title: 'Febrero' });
		await createMealPlan(ownFamily, { ...LENTES, date: '2026-04-01', title: 'Abril' });

		const byDay = await listMealPlans(ownFamily, '2026-03');
		// Solo hay grupo para el día CON menús, con la misma clave `YYYY-MM-DD`
		// que llevan las celdas del grid.
		expect(Object.keys(byDay)).toEqual(['2026-03-10']);
		const day = byDay['2026-03-10'] ?? [];
		// El desayuno va antes que el almuerzo aunque se creara después.
		expect(day.map((meal) => [meal.mealType, meal.title])).toEqual([
			['breakfast', 'Tostadas con tomate'],
			['lunch', 'Lentejas con verduras']
		]);
		expect(day.map((meal) => meal.id)).toEqual([desayuno.id, almuerzo.id]);
		// Los ingredientes llegan en su posición y con el Decimal aplanado.
		expect(day[1]?.ingredients.map((ingredient) => ingredient.name)).toEqual([
			'Lentejas pardinas',
			'Cebolla'
		]);
		expect(day[1]?.ingredients[0]?.quantity).toBe(0.5);
	});

	it('listMealPlans rechaza una clave de mes basura', async () => {
		// La carga del calendario valida `?month=` con `monthKeySchema` antes de
		// llamar; aquí solo se defiende el módulo de basura que no debe llegar
		// a la base (el mes 13 o una clave sin formato).
		await expect(listMealPlans(randomUUID(), '2026-13')).rejects.toThrow(RangeError);
		await expect(listMealPlans(randomUUID(), 'basura')).rejects.toThrow(RangeError);
	});
});
