import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): las funciones de
// `#lib/server/recipes.ts` contra un Postgres real con las migraciones
// aplicadas. Como en `mealplans.int.spec.ts` no hacen falta sesiones: las
// familias de prueba se crean directamente con Prisma (el plugin de tenancy
// no entra en el camino) y lo que se ejercita es el CRUD de recetas con el
// filtro de familia activa — los criterios de aceptación de la tarea #238:
// las cuatro operaciones en verde, el único (familia, nombre normalizado) con
// `RecipeExistsError`, el aislamiento entre familias, los snapshot de los
// ingredientes (producto y categoría pueden morir sin tocar la receta), el
// `SetNull` del menú al borrar la receta y NINGÚN producto creado en despensa.
import prisma from './prisma.js';
import { createCategory, deleteCategory } from './categories.js';
import type { RecipeData } from './recipes.js';
import {
	RecipeExistsError,
	createRecipe,
	deleteRecipe,
	listRecipes,
	updateRecipe
} from './recipes.js';

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

/** Datos válidos de receta, para mutar campo a campo en cada spec. */
const LENTEJAS: RecipeData = {
	name: 'Lentejas con verduras',
	servings: 4,
	ingredients: [
		{ name: 'Lentejas pardinas', quantity: 0.5, unit: 'kilogram' },
		{ name: 'Cebolla', quantity: 2, unit: 'unit' }
	]
};

describe('CRUD de recetas por familia (#238)', () => {
	it('createRecipe guarda nombre, canónico, servings e ingredientes con posición del servidor', async () => {
		const familyId = await familyRow('Familia Cocinera');

		const recipe = await createRecipe(familyId, LENTEJAS);
		expect(recipe).toMatchObject({ name: 'Lentejas con verduras', servings: 4 });
		expect(recipe.ingredients.map((ingredient) => [ingredient.name, ingredient.quantity])).toEqual([
			['Lentejas pardinas', 0.5],
			['Cebolla', 2]
		]);

		// El canónico de búsqueda lo calcula el SERVIDOR con el mismo
		// `normalizeItemName` de la despensa: minúsculas, sin acentos y espacios
		// colapsados.
		const row = await prisma.recipe.findUniqueOrThrow({ where: { id: recipe.id } });
		expect(row.normalizedName).toBe('lentejas con verduras');

		// La posición la fija el SERVIDOR (el schema no trae default): el orden
		// del formulario, desde 0.
		const rows = await prisma.recipeIngredient.findMany({
			where: { recipeId: recipe.id },
			orderBy: { position: 'asc' }
		});
		expect(rows.map((ingredient) => ingredient.position)).toEqual([0, 1]);
	});

	it('createRecipe rechaza el duplicado por familia (RecipeExistsError); otra familia no', async () => {
		const ownFamily = await familyRow('Familia Repetida');
		const otherFamily = await familyRow('Familia Otra');
		await createRecipe(ownFamily, LENTEJAS);

		// El mismo nombre exacto choca con el único (familia, nombre normalizado)
		// y sale como el error de dominio que la acción traducirá al mensaje
		// genérico de la UI.
		await expect(createRecipe(ownFamily, LENTEJAS)).rejects.toBeInstanceOf(RecipeExistsError);

		// Las variantes que `normalizeItemName` hace canónicamente igual, también:
		// mayúsculas, acentos y espacios de más.
		await expect(
			createRecipe(ownFamily, { ...LENTEJAS, name: 'lentejas con verduras' })
		).rejects.toBeInstanceOf(RecipeExistsError);
		await expect(
			createRecipe(ownFamily, { ...LENTEJAS, name: '  LENTEJAS  CON  VERDURAS  ' })
		).rejects.toBeInstanceOf(RecipeExistsError);

		// En OTRA familia el mismo nombre es válido: el único lleva la familia delante.
		await expect(createRecipe(otherFamily, LENTEJAS)).resolves.toBeDefined();
	});

	it('guardar una receta NO crea productos en despensa', async () => {
		const familyId = await familyRow('Familia Sin Despensa');

		await createRecipe(familyId, LENTEJAS);

		// A diferencia del menú, la receta es un libro de cocina: sus
		// ingredientes van snapshotados y la despensa queda intacta.
		expect(await prisma.pantryItem.findMany({ where: { organizationId: familyId } })).toHaveLength(
			0
		);
	});

	it('el pantryItemId existente se guarda tal cual; ajeno o rancio queda en null', async () => {
		const ownFamily = await familyRow('Familia Enlazada');
		const otherFamily = await familyRow('Familia Ajena Enlazada');
		const propia = await prisma.pantryItem.create({
			data: {
				organizationId: ownFamily,
				name: 'Leche entera',
				normalizedName: 'leche entera',
				quantity: 3,
				unit: 'liter'
			}
		});
		const ajena = await prisma.pantryItem.create({
			data: {
				organizationId: otherFamily,
				name: 'Leche ajena',
				normalizedName: 'leche ajena',
				quantity: 1,
				unit: 'liter'
			}
		});

		const recipe = await createRecipe(ownFamily, {
			...LENTEJAS,
			ingredients: [
				// El producto de la familia: el enlace va tal cual…
				{ name: 'Leche entera', quantity: 1, unit: 'liter', pantryItemId: propia.id },
				// …el de OTRA familia y el que ya no existe quedan sin enlace, sin
				// 500 por violar la FK.
				{ name: 'Leche condensada', quantity: 0.2, unit: 'liter', pantryItemId: ajena.id },
				{ name: 'Azúcar', quantity: 0.1, unit: 'kilogram', pantryItemId: randomUUID() }
			]
		});

		expect(recipe.ingredients.map((ingredient) => ingredient.pantryItemId)).toEqual([
			propia.id,
			null,
			null
		]);
		// Ni un producto nuevo: enlazar no es crear (eso es cosa de los menús).
		expect(await prisma.pantryItem.findMany({ where: { organizationId: ownFamily } })).toHaveLength(
			1
		);
	});

	it('la categoría del ingrediente ajena o rancia se guarda como «sin categoría», sin 500', async () => {
		const ownFamily = await familyRow('Familia Categorizadora');
		const otherFamily = await familyRow('Familia Ajena Categorial');
		const foreign = await createCategory(otherFamily, { name: 'Ajena' });

		const recipe = await createRecipe(ownFamily, {
			...LENTEJAS,
			ingredients: [
				// El id de UNA categoría de OTRA familia…
				{ name: 'Cebolla', quantity: 2, unit: 'unit', categoryId: foreign.id },
				// …y un id que ya no existe (rancio): mismo efecto que el SetNull.
				{ name: 'Ajo', quantity: 1, unit: 'unit', categoryId: randomUUID() }
			]
		});

		expect(recipe.ingredients.map((ingredient) => ingredient.categoryId)).toEqual([null, null]);
	});

	it('updateRecipe reemplaza los ingredientes entera y actualiza nombre y servings', async () => {
		const familyId = await familyRow('Familia Editora');
		const recipe = await createRecipe(familyId, LENTEJAS);

		const edited = await updateRecipe(familyId, recipe.id, {
			...LENTEJAS,
			name: 'Lentejas rápidas',
			servings: 2,
			ingredients: [{ name: 'Lentejas pardinas', quantity: 0.3, unit: 'kilogram' }]
		});
		expect(edited).toBe(true);

		// La cebolla de la primera edición NO sobrevive: el reemplazo es entero,
		// como `updateMealPlan` sustituye los del menú.
		const rows = await prisma.recipeIngredient.findMany({
			where: { recipeId: recipe.id },
			orderBy: { position: 'asc' }
		});
		expect(rows.map((ingredient) => [ingredient.name, ingredient.position])).toEqual([
			['Lentejas pardinas', 0]
		]);
		expect(Number(rows[0]?.quantity)).toBe(0.3);

		const row = await prisma.recipe.findUniqueOrThrow({ where: { id: recipe.id } });
		expect(row.name).toBe('Lentejas rápidas');
		expect(row.normalizedName).toBe('lentejas rapidas');
		expect(row.servings).toBe(2);

		// Quitar el servings lo deja en null (la receta deja de declararlo).
		const sinRaciones: RecipeData = { name: 'Lentejas rápidas', ingredients: LENTEJAS.ingredients };
		expect(await updateRecipe(familyId, recipe.id, sinRaciones)).toBe(true);
		expect(
			(await prisma.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).servings
		).toBeNull();
	});

	it('updateRecipe a un nombre ocupado sale como error controlado, sin dejar nada a medias', async () => {
		const familyId = await familyRow('Familia Renombradora');
		const lentejas = await createRecipe(familyId, LENTEJAS);
		const garbanzos = await createRecipe(familyId, {
			...LENTEJAS,
			name: 'Garbanzos con espinacas',
			servings: 2,
			ingredients: [{ name: 'Garbanzo cocido', quantity: 0.4, unit: 'kilogram' }]
		});

		// Los garbanzos pasan a llamarse como las lentejas: el único (familia,
		// nombre normalizado) lo rechaza como el alta.
		await expect(
			updateRecipe(familyId, garbanzos.id, { ...LENTEJAS, name: 'Lentejas con verduras' })
		).rejects.toBeInstanceOf(RecipeExistsError);

		// El rechazo revierte TODO: los garbanzos conservan nombre, servings y
		// sus PROPIOS ingredientes (el borra-y-crea se deshizo entero).
		const intact = await prisma.recipe.findUniqueOrThrow({
			where: { id: garbanzos.id },
			include: { ingredients: true }
		});
		expect(intact.name).toBe('Garbanzos con espinacas');
		expect(intact.servings).toBe(2);
		expect(intact.ingredients).toHaveLength(1);
		expect(intact.ingredients[0]?.name).toBe('Garbanzo cocido');

		// Editar sin cambiar el nombre no choca consigo mismo: Postgres ignora
		// el update que no cambia los valores de la fila.
		expect(
			await updateRecipe(familyId, garbanzos.id, {
				...LENTEJAS,
				name: 'Garbanzos con espinacas',
				servings: 3
			})
		).toBe(true);
		// Las lentejas quedaron fuera de la maniobra.
		expect((await prisma.recipe.findUniqueOrThrow({ where: { id: lentejas.id } })).servings).toBe(
			LENTEJAS.servings
		);
	});

	it('updateRecipe no toca una receta de otra familia o inexistente', async () => {
		const ownFamily = await familyRow('Familia Propia');
		const otherFamily = await familyRow('Familia Intacta');
		const ownRecipe = await createRecipe(ownFamily, LENTEJAS);
		const foreignRecipe = await createRecipe(otherFamily, LENTEJAS);

		// El id de una receta de OTRA familia no se puede editar aunque se conozca.
		expect(await updateRecipe(ownFamily, foreignRecipe.id, { ...LENTEJAS, name: 'Vándalo' })).toBe(
			false
		);
		expect((await prisma.recipe.findUniqueOrThrow({ where: { id: foreignRecipe.id } })).name).toBe(
			LENTEJAS.name
		);

		// Igual con un id inexistente.
		expect(await updateRecipe(ownFamily, randomUUID(), LENTEJAS)).toBe(false);
		// Y la edición fallida no tocó la propia.
		expect((await prisma.recipe.findUniqueOrThrow({ where: { id: ownRecipe.id } })).name).toBe(
			LENTEJAS.name
		);
	});

	it('deleteRecipe borra la propia con sus ingredientes; una ajena devuelve false y queda', async () => {
		const ownFamily = await familyRow('Familia Borradora');
		const otherFamily = await familyRow('Familia Superviviente');
		const ownRecipe = await createRecipe(ownFamily, LENTEJAS);
		const foreignRecipe = await createRecipe(otherFamily, LENTEJAS);

		// La ajena no se puede borrar aunque se conozca su id…
		expect(await deleteRecipe(ownFamily, foreignRecipe.id)).toBe(false);
		expect(await prisma.recipe.findUnique({ where: { id: foreignRecipe.id } })).not.toBeNull();
		expect(await deleteRecipe(ownFamily, randomUUID())).toBe(false);

		// …y la propia sí, llevándose sus ingredientes en cascada. La despensa
		// NO se toca: nunca la tocó (ver el spec del alta).
		expect(await deleteRecipe(ownFamily, ownRecipe.id)).toBe(true);
		expect(await prisma.recipe.findUnique({ where: { id: ownRecipe.id } })).toBeNull();
		expect(
			await prisma.recipeIngredient.findMany({ where: { recipeId: ownRecipe.id } })
		).toHaveLength(0);
		expect(await prisma.pantryItem.findMany({ where: { organizationId: ownFamily } })).toHaveLength(
			0
		);
	});

	it('borrar el producto o la categoría deja los ingredientes intactos (SetNull): el snapshot sobrevive', async () => {
		const familyId = await familyRow('Familia Sin Productos');
		const lacteos = await createCategory(familyId, { name: 'Lácteos' });
		const leche = await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Leche entera',
				normalizedName: 'leche entera',
				quantity: 3,
				unit: 'liter'
			}
		});

		const recipe = await createRecipe(familyId, {
			...LENTEJAS,
			ingredients: [
				{ name: 'Leche entera', quantity: 1, unit: 'liter', pantryItemId: leche.id },
				{ name: 'Mantequilla', quantity: 0.1, unit: 'kilogram', categoryId: lacteos.id }
			]
		});

		await prisma.pantryItem.delete({ where: { id: leche.id } });
		await deleteCategory(familyId, lacteos.id);

		// Cada ingrediente conserva SU snapshot — nombre, cantidad y unidad viven
		// en la fila —; solo las referencias desaparecen (el efecto del `SetNull`
		// de ambas FKs).
		const rows = await prisma.recipeIngredient.findMany({
			where: { recipeId: recipe.id },
			orderBy: { position: 'asc' }
		});
		expect(rows.map((ingredient) => [ingredient.name, ingredient.unit])).toEqual([
			['Leche entera', 'liter'],
			['Mantequilla', 'kilogram']
		]);
		expect(Number(rows[0]?.quantity)).toBe(1);
		expect(rows[0]?.pantryItemId).toBeNull();
		expect(Number(rows[1]?.quantity)).toBe(0.1);
		expect(rows[1]?.categoryId).toBeNull();
	});

	it('borrar la receta deja el menú que originó con recipeId en null (SetNull)', async () => {
		const familyId = await familyRow('Familia Menuera');
		const recipe = await createRecipe(familyId, LENTEJAS);
		const meal = await prisma.mealPlan.create({
			data: {
				organizationId: familyId,
				date: new Date('2026-03-10T00:00:00Z'),
				mealType: 'lunch',
				title: recipe.name,
				recipeId: recipe.id
			}
		});

		await deleteRecipe(familyId, recipe.id);

		// El menú vive solo de su snapshot: sigue entero y pierde solo la
		// referencia a la receta que lo originó.
		const after = await prisma.mealPlan.findUniqueOrThrow({ where: { id: meal.id } });
		expect(after).toMatchObject({ title: 'Lentejas con verduras', recipeId: null });
	});

	it('listRecipes ordena alfabético por nombre visible y solo devuelve las de la familia', async () => {
		const ownFamily = await familyRow('Familia Lectora');
		const otherFamily = await familyRow('Familia Ajena');

		// Se crean DESORDENADAS a propósito: el listado manda el nombre.
		const caldo = await createRecipe(ownFamily, { ...LENTEJAS, name: 'Caldo de verduras' });
		const arroz = await createRecipe(ownFamily, { ...LENTEJAS, name: 'Arroz con pollo' });
		const bizcocho = await createRecipe(ownFamily, { ...LENTEJAS, name: 'Bizcocho de yogur' });
		// El secreto de la otra familia no puede asomar en el listado.
		await createRecipe(otherFamily, { ...LENTEJAS, name: 'Receta ajena' });

		const recipes = await listRecipes(ownFamily);
		expect(recipes.map((recipe) => recipe.name)).toEqual([
			'Arroz con pollo',
			'Bizcocho de yogur',
			'Caldo de verduras'
		]);
		expect(recipes.map((recipe) => recipe.id)).toEqual([arroz.id, bizcocho.id, caldo.id]);
		// Los ingredientes llegan en su posición y con el Decimal aplanado.
		expect(recipes[0]?.ingredients.map((ingredient) => ingredient.name)).toEqual([
			'Lentejas pardinas',
			'Cebolla'
		]);
		expect(recipes[0]?.ingredients[0]?.quantity).toBe(0.5);
	});

	it('borrar la familia se lleva sus recetas y sus ingredientes (FK en cascada)', async () => {
		const familyId = await familyRow('Familia Evanescente');
		const recipe = await createRecipe(familyId, LENTEJAS);

		await prisma.organization.delete({ where: { id: familyId } });

		expect(await prisma.recipe.findMany({ where: { organizationId: familyId } })).toHaveLength(0);
		expect(await prisma.recipeIngredient.findMany({ where: { recipeId: recipe.id } })).toHaveLength(
			0
		);
	});
});
