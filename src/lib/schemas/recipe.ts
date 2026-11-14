import { z } from 'zod/v4';
import { UNITS, quantitySchema } from './item.js';

/** Textos inyectables del schema de receta. Defaults: ninguno (el consumidor los pasa). */
export type RecipeSchemaStrings = {
	nameError?: string;
	nameLabel?: string;
	servingsError?: string;
	servingsLabel?: string;
	ingredientNameError?: string;
	ingredientNameLabel?: string;
	quantityError?: string;
	quantityLabel?: string;
	unitError?: string;
	unitLabel?: string;
	categoryLabel?: string;
	pantryItemLabel?: string;
};

/**
 * El techo de la columna `Int` de Postgres (int4): el contrato exacto de
 * `servings`, con el mismo criterio de `quantitySchema` (issue #107) — nada
 * llega a la base dispuesto a desbordar. El mínimo lo pone el propio schema
 * (una receta no rinde cero ni raciones negativas).
 */
const SERVINGS_MAX = 2_147_483_647;

/**
 * El schema de UN ingrediente de la receta. El límite del nombre replica el
 * del item, la lista y la familia (1–100). La cantidad es el contrato
 * compartido `quantitySchema` (issue #107): exactamente lo que aguanta la
 * columna `DECIMAL(10,3)` — nada llega a la base dispuesto a ser redondeado o
 * a desbordar. La categoría y el producto de despensa son OPCIONALES y aquí
 * solo se valida la forma: que pertenezcan a la familia lo resuelve el
 * SERVIDOR (`resolveCategoryId` y `resolvePantryItemId` de `recipes.ts`,
 * igual que en el item y el menú) — el formulario no puede autorizar por id.
 */
function ingredientSchema(strings?: RecipeSchemaStrings) {
	return z.object({
		name: z
			.string()
			.trim()
			.min(1, strings?.ingredientNameError)
			.max(100, strings?.ingredientNameError)
			.meta({ description: strings?.ingredientNameLabel }),
		quantity: quantitySchema(strings?.quantityError).meta({ description: strings?.quantityLabel }),
		unit: z.enum(UNITS, strings?.unitError).meta({ description: strings?.unitLabel }),
		categoryId: z.string().optional().meta({ description: strings?.categoryLabel }),
		pantryItemId: z.string().optional().meta({ description: strings?.pantryItemLabel })
	});
}

/**
 * Factoría del schema de receta (sirve para crear y editar: los campos son
 * los mismos): nunca un schema con textos ya compilados en scope de módulo
 * (regla i18n de la librería), para que el consumidor resuelva su Paraglide
 * cuando toque (en render en el cliente y en request en el servidor).
 *
 * El nombre comparte el límite del resto de nombres de la app (1–100) y NO
 * valida duplicados: «Tortilla» y «tortilla» pasan el formulario y el choque
 * lo detecta el servidor sobre el nombre normalizado (`normalizeItemName`),
 * que es el contrato de único de la base (como en categorías y
 * establecimientos). `servings` es OPCIONAL (no toda receta declara raciones):
 * un entero positivo dentro del contrato de la columna `Int`.
 *
 * Los ingredientes van en array y puede ir VACÍO: una receta sin ingredientes
 * es una receta válida — y guardarla NUNCA crea productos en despensa: el
 * `pantryItemId` del ingrediente es solo un enlace opcional a un producto que
 * YA existe (lo resuelve el servidor), no una promesa de despensa (ver
 * `recipes.ts`; el alta de productos es cosa de los menús,
 * `ensurePantryProducts`). Es lo que las acciones de las vistas de recetas
 * validarán con superforms antes de llamar al CRUD del servidor.
 */
export function recipeSchema(strings?: RecipeSchemaStrings) {
	return z.object({
		name: z
			.string()
			.trim()
			.min(1, strings?.nameError)
			.max(100, strings?.nameError)
			.meta({ description: strings?.nameLabel }),
		servings: z
			.number(strings?.servingsError)
			.int(strings?.servingsError)
			.min(1, strings?.servingsError)
			.max(SERVINGS_MAX, strings?.servingsError)
			.optional()
			.meta({ description: strings?.servingsLabel }),
		ingredients: z.array(ingredientSchema(strings))
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type RecipeSchema = ReturnType<typeof recipeSchema>;

/** Los datos validados por el schema. */
export type RecipeFormData = z.infer<RecipeSchema>;

/**
 * El contrato de EDITAR receta: los campos de crear MÁS el id de la receta.
 * El id no va en el schema compartido (crear y editar tienen los mismos
 * campos), así que la vista lo inyecta en el JSON de salida y el action de
 * editar valida con ESTE schema — un `extend` del de crear, para no repetir
 * un solo texto ni un solo campo (mismo patrón que `mealPlanUpdateSchema`
 * de la vista de calendario). Va OPCIONAL a propósito: si un id ausente o
 * vacío (petición hecha a mano) muriera en el schema, el 400 no llevaría
 * mensaje y la UI no podría avisar; así el action lo convierte en el aviso
 * controlado «no existe».
 */
export function recipeUpdateSchema(strings?: RecipeSchemaStrings) {
	return recipeSchema(strings).extend({ id: z.string().optional() });
}

/** El schema de edición (lo que esperan los adaptadores de superforms). */
export type RecipeUpdateSchema = ReturnType<typeof recipeUpdateSchema>;
