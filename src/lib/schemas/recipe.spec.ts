import { describe, expect, it } from 'vitest';
import { UNITS } from './item.js';
import { recipeSchema, recipeUpdateSchema } from './recipe.js';

/** Datos mínimos que el schema acepta, para mutar campo a campo en cada spec. */
const VALID = {
	name: 'Tortilla de patatas',
	servings: 4,
	ingredients: [{ name: 'Huevos', quantity: 6, unit: 'unit' }]
} as const;

describe('recipeSchema', () => {
	it('acepta datos válidos y recorta el nombre y el del ingrediente', () => {
		const result = recipeSchema().safeParse({
			...VALID,
			name: `  ${VALID.name}  `,
			ingredients: [{ name: '  Huevos  ', quantity: 6, unit: 'unit' }]
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.name).toBe(VALID.name);
			expect(result.data.ingredients[0]?.name).toBe('Huevos');
		}
	});

	it('exige nombre: vacío o solo espacios no valida; máximo 100, como el resto de nombres', () => {
		expect(recipeSchema().safeParse({ ...VALID, name: '' }).success).toBe(false);
		expect(recipeSchema().safeParse({ ...VALID, name: '   ' }).success).toBe(false);
		expect(recipeSchema().safeParse({ ...VALID, name: 'a'.repeat(100) }).success).toBe(true);
		expect(recipeSchema().safeParse({ ...VALID, name: 'a'.repeat(101) }).success).toBe(false);
	});

	it('acepta una receta SIN servings: no toda receta declara raciones', () => {
		const withoutServings = recipeSchema().safeParse({
			name: VALID.name,
			ingredients: VALID.ingredients
		});

		expect(withoutServings.success).toBe(true);
		if (withoutServings.success) {
			expect(withoutServings.data.servings).toBeUndefined();
		}
	});

	it('servings es un entero positivo dentro del contrato de la columna Int', () => {
		const withServings = (servings: unknown) =>
			recipeSchema().safeParse({ ...VALID, servings }).success;

		// 0 y negativos no son raciones.
		expect(withServings(0)).toBe(false);
		expect(withServings(-2)).toBe(false);
		// Los decimales tampoco: la columna es Int, no Decimal.
		expect(withServings(2.5)).toBe(false);
		// El techo exacto del int4; por encima, desbordamiento.
		expect(withServings(2_147_483_647)).toBe(true);
		expect(withServings(2_147_483_648)).toBe(false);
	});

	it('acepta ingredientes vacíos: una receta sin ingredientes es una receta válida', () => {
		const result = recipeSchema().safeParse({ ...VALID, ingredients: [] });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.ingredients).toEqual([]);
		}
	});

	it('exige nombre de ingrediente: vacío o solo espacios no valida', () => {
		const blank = {
			name: '   ',
			quantity: 1,
			unit: 'unit'
		};
		expect(recipeSchema().safeParse({ ...VALID, ingredients: [blank] }).success).toBe(false);
	});

	it('la cantidad del ingrediente comparte el contrato exacto de la columna (#107)', () => {
		const withQuantity = (quantity: unknown) =>
			recipeSchema().safeParse({
				...VALID,
				ingredients: [{ name: 'Cebolla', quantity, unit: 'unit' }]
			}).success;

		// 0 y negativos no validan (mínimo una milésima).
		expect(withQuantity(0)).toBe(false);
		expect(withQuantity(-1.5)).toBe(false);
		// Lo que la base redondearía por su cuenta, tampoco.
		expect(withQuantity(0.0001)).toBe(false);
		expect(withQuantity(1.2345)).toBe(false);
		// Techo exacto de la DECIMAL(10,3); por encima, desbordamiento.
		expect(withQuantity(9_999_999.999)).toBe(true);
		expect(withQuantity(10_000_000)).toBe(false);
		// Múltiplos de la milésima hostiles a la coma flotante sí pasan.
		expect(withQuantity(0.003)).toBe(true);
		expect(withQuantity(2.75)).toBe(true);
	});

	it('la unidad del ingrediente es del catálogo compartido UNITS', () => {
		expect(
			recipeSchema().safeParse({
				...VALID,
				ingredients: [{ name: 'Cebolla', quantity: 2, unit: 'cubículo' }]
			}).success
		).toBe(false);
		for (const unit of UNITS) {
			expect(
				recipeSchema().safeParse({
					...VALID,
					ingredients: [{ name: 'Cebolla', quantity: 2, unit }]
				}).success
			).toBe(true);
		}
	});

	it('acepta categoryId y pantryItemId opcionales: ausentes y vacíos validan', () => {
		// Aquí solo se valida la forma: que categoría y producto pertenezcan a
		// la familia lo resuelve el SERVIDOR (`resolveCategoryId` y
		// `resolvePantryItemId` de `recipes.ts`) — el formulario no puede
		// autorizar por id.
		const absent = recipeSchema().safeParse({
			...VALID,
			ingredients: [{ name: 'Cebolla', quantity: 2, unit: 'unit' }]
		});
		expect(absent.success).toBe(true);
		if (absent.success) {
			expect(absent.data.ingredients[0]?.categoryId).toBeUndefined();
			expect(absent.data.ingredients[0]?.pantryItemId).toBeUndefined();
		}

		const empty = recipeSchema().safeParse({
			...VALID,
			ingredients: [
				{ name: 'Cebolla', quantity: 2, unit: 'unit', categoryId: '', pantryItemId: '' }
			]
		});
		expect(empty.success).toBe(true);
		if (empty.success) {
			expect(empty.data.ingredients[0]?.categoryId).toBe('');
			expect(empty.data.ingredients[0]?.pantryItemId).toBe('');
		}
	});

	it('no valida duplicados: eso lo decide el único de la base sobre el nombre normalizado', () => {
		// «Tortilla» y «TORTILLA» pasan el formulario por separado: el choque lo
		// detecta el servidor (`RecipeExistsError` vía P2002), que es quien
		// conoce el canónico (`normalizeItemName`).
		expect(recipeSchema().safeParse({ ...VALID, name: 'Tortilla' }).success).toBe(true);
		expect(recipeSchema().safeParse({ ...VALID, name: 'TORTILLA' }).success).toBe(true);
	});
});

describe('recipeUpdateSchema', () => {
	it('valida los mismos campos que crear, más un id opcional', () => {
		const valid = recipeUpdateSchema().safeParse({ ...VALID, id: 'receta-1' });

		expect(valid.success).toBe(true);
		if (valid.success) {
			expect(valid.data.id).toBe('receta-1');
		}

		// Sin id también valida: una petición hecha a mano sin id no muere en el
		// schema; el action la convierte en el aviso controlado «no existe».
		const withoutId = recipeUpdateSchema().safeParse(VALID);
		expect(withoutId.success).toBe(true);
		if (withoutId.success) {
			expect(withoutId.data.id).toBeUndefined();
		}
	});

	it('rechaza lo mismo que el schema de crear', () => {
		expect(recipeUpdateSchema().safeParse({ ...VALID, name: '' }).success).toBe(false);
		expect(recipeUpdateSchema().safeParse({ ...VALID, servings: 0 }).success).toBe(false);
		expect(
			recipeUpdateSchema().safeParse({
				...VALID,
				ingredients: [{ name: 'Huevos', quantity: 0, unit: 'unit' }]
			}).success
		).toBe(false);
	});
});
