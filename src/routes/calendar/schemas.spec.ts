import { describe, expect, it } from 'vitest';
import { recipeMealPlanFormSchema } from '../recipes/schemas.js';
import { mealPlanFormSchema, mealPlanWithRecipeSchema } from './schemas.js';

// El contrato de crear menú CON receta de origen (#252): el schema de crear
// extendido con el `recipeId` opcional que manda el buscador del modal. El
// mismo patrón del `id` en edición (`mealPlanUpdateSchema`): el schema solo
// garantiza la FORMA — que la receta pertenezca a la familia lo resuelve el
// SERVIDOR (`resolveRecipeId` de `mealplans.ts`), que un id ajeno o rancio
// se guarda «sin receta» sin 500. Sin receta, el alta manual valida EXACTO
// igual que antes. Los textos de Paraglide caen en la locale base en el
// spec (server, sin request): da igual, aquí no se asserta ningún texto.

/** Un formulario de crear menú válido, con una fila de ingrediente completa. */
const VALID_MEAL = {
	title: 'Lentejas con verduras',
	date: '2026-11-15',
	mealType: 'lunch',
	ingredients: [{ name: 'Lentejas pardinas', quantity: 0.5, unit: 'kilogram', categoryId: '' }]
};

describe('mealPlanWithRecipeSchema', () => {
	it('acepta el alta manual sin receta: valida igual que el schema de crear', () => {
		const conReceta = mealPlanWithRecipeSchema().safeParse(VALID_MEAL);
		const sinReceta = mealPlanFormSchema().safeParse(VALID_MEAL);
		expect(conReceta.success).toBe(true);
		expect(sinReceta.success).toBe(true);
		// Los datos validados son los MISMOS campos: el extendido solo añade
		// la posibilidad del `recipeId`, no toca nada más.
		expect(conReceta.success && sinReceta.success && conReceta.data).toEqual(sinReceta.data);
		// Y sin receta elegida no inventa ninguna: sale sin `recipeId`.
		expect(
			conReceta.success && (conReceta.data.recipeId === undefined || conReceta.data.recipeId === '')
		).toBe(true);
	});

	it('acepta el recipeId de la receta elegida y lo conserva en los datos', () => {
		const result = mealPlanWithRecipeSchema().safeParse({
			...VALID_MEAL,
			recipeId: 'cmbreceta123'
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.recipeId).toBe('cmbreceta123');
		}
	});

	it('no exige la receta: es opcional a propósito (el alta manual es un camino válido)', () => {
		const sinClave = mealPlanWithRecipeSchema().safeParse(VALID_MEAL);
		expect(sinClave.success).toBe(true);
		// Un string vacío tampoco muere en el schema (submit nativo sin JS del
		// input oculto): solo valida la forma — el servidor lo guarda «sin
		// receta» vía `resolveRecipeId`.
		const vacio = mealPlanWithRecipeSchema().safeParse({ ...VALID_MEAL, recipeId: '' });
		expect(vacio.success).toBe(true);
	});

	it('mantiene el contrato del día: solo claves reales YYYY-MM-DD', () => {
		// La fecha imposible hace ROLLOVER en `Date`: el schema la rechaza
		// (el round-trip no devuelve la misma clave).
		expect(
			mealPlanWithRecipeSchema().safeParse({ ...VALID_MEAL, date: '2026-02-31' }).success
		).toBe(false);
		expect(
			mealPlanWithRecipeSchema().safeParse({ ...VALID_MEAL, date: '16-11-2026' }).success
		).toBe(false);
	});

	it('mantiene el contrato del tipo de comida: solo el enum del catálogo', () => {
		expect(
			mealPlanWithRecipeSchema().safeParse({ ...VALID_MEAL, mealType: 'brunch' }).success
		).toBe(false);
	});

	it('mantiene el contrato de los ingredientes: nombre, cantidad y unidad', () => {
		expect(
			mealPlanWithRecipeSchema().safeParse({
				...VALID_MEAL,
				ingredients: [{ quantity: 1, unit: 'unit' }]
			}).success
		).toBe(false);
		// La cantidad comparte el contrato del item (`quantitySchema`, #107):
		// mínimo una milésima — ni un 0 que la base redondearía a vacío.
		expect(
			mealPlanWithRecipeSchema().safeParse({
				...VALID_MEAL,
				ingredients: [{ name: 'Sal', quantity: 0, unit: 'unit' }]
			}).success
		).toBe(false);
	});
});

describe('recipeMealPlanFormSchema', () => {
	it('delega en el schema extendido del calendario: un solo contrato (#252)', () => {
		// El schema de /recipes (#242) y el del calendario (#252) son EL MISMO:
		// el mismo formulario valido en los dos caminos, con o sin receta.
		const base = mealPlanWithRecipeSchema().safeParse({ ...VALID_MEAL, recipeId: 'cmb123' });
		const delegado = recipeMealPlanFormSchema().safeParse({ ...VALID_MEAL, recipeId: 'cmb123' });
		expect(delegado.success).toBe(true);
		expect(delegado.success && base.success && delegado.data).toEqual(base.data);
	});
});
