import { z } from 'zod/v4';
import { UNITS, quantitySchema } from './item.js';

/**
 * Tipos de comida de un menú (épica #212): desayuno, comida, cena y otro.
 * Los valores son identificadores estables en inglés — es lo que guarda el
 * enum nativo `mealType` de la base de datos — y NUNCA se muestran tal cual:
 * la UI los traduce con las claves `meal_*` de Paraglide (llegan con la vista
 * de menú, #215/#216). El catálogo replica el enum de Prisma y un spec
 * garantiza que no se separan, igual que las `UNITS` del item.
 */
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'other'] as const;

/** Un tipo de comida del catálogo. */
export type MealTypeValue = (typeof MEAL_TYPES)[number];

/** Textos inyectables del schema de menú. Defaults: ninguno (el consumidor los pasa). */
export type MealPlanSchemaStrings = {
	titleError?: string;
	titleLabel?: string;
	dateError?: string;
	dateLabel?: string;
	mealTypeError?: string;
	mealTypeLabel?: string;
	ingredientNameError?: string;
	ingredientNameLabel?: string;
	quantityError?: string;
	quantityLabel?: string;
	unitError?: string;
	unitLabel?: string;
	categoryLabel?: string;
};

/** El patrón estricto de una clave de día (`YYYY-MM-DD`), la fecha que viaja del formulario. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El contrato de UNA fecha de menú: la clave `YYYY-MM-DD` de un día que
 * EXISTE de verdad. El patrón solo garantiza la forma — el parseo ISO de
 * `Date` hace ROLLOVER, no invalida: `2026-02-31` es para JS el 1 de marzo,
 * y guardar un menú así lo colocaría en un día distinto al que el usuario
 * eligió (a veces en otro mes del calendario). La fecha solo es real si el
 * round-trip devuelve la misma clave. Los años van acotados al calendario
 * navegable (1900–2099), la misma cota de `monthKeySchema` del grid — fuera
 * de ella el calendario no puede mostrar el menú ni el usuario llegó ahí por
 * sus controles.
 */
export function dayKeySchema(error?: string) {
	return z
		.string(error)
		.regex(DAY_KEY_PATTERN, error)
		.refine((value) => {
			const year = Number(value.slice(0, 4));
			if (year < 1900 || year > 2099) {
				return false;
			}
			const date = new Date(`${value}T00:00:00Z`);
			return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
		}, error);
}

/**
 * El schema de UN ingrediente del menú. El límite del nombre replica el del
 * item, la lista y la familia (1–100). La cantidad es el contrato compartido
 * `quantitySchema` (issue #107): exactamente lo que aguanta la columna
 * `DECIMAL(10,3)` — nada llega a la base dispuesto a ser redondeado o a
 * desbordar. La categoría es OPCIONAL y aquí solo se valida la forma (que
 * pertenezca a la familia lo resuelve el SERVIDOR, `resolveCategoryId` de
 * `mealplans.ts`, igual que en el item): el formulario no puede autorizar
 * por id.
 */
function ingredientSchema(strings?: MealPlanSchemaStrings) {
	return z.object({
		name: z
			.string()
			.trim()
			.min(1, strings?.ingredientNameError)
			.max(100, strings?.ingredientNameError)
			.meta({ description: strings?.ingredientNameLabel }),
		quantity: quantitySchema(strings?.quantityError).meta({ description: strings?.quantityLabel }),
		unit: z.enum(UNITS, strings?.unitError).meta({ description: strings?.unitLabel }),
		categoryId: z.string().optional().meta({ description: strings?.categoryLabel })
	});
}

/**
 * Factoría del schema de menú (sirve para crear y editar: los campos son los
 * mismos): nunca un schema con textos ya compilados en scope de módulo (regla
 * i18n de la librería), para que el consumidor resuelva su Paraglide cuando
 * toque (en render en el cliente y en request en el servidor).
 *
 * El título admite varios platos (un menú por comida y día) y comparte el
 * límite del nombre (1–100). Los ingredientes van en array y puede ir VACÍO:
 * un menú sin ingredientes es un menú válido (el producto se garantiza al
 * guardar cada ingrediente, ver `ensurePantryProducts` de `mealplans.ts`).
 * Es lo que la acción de la vista de menú (#216) valida con superforms antes
 * de llamar al CRUD del servidor.
 */
export function mealPlanSchema(strings?: MealPlanSchemaStrings) {
	return z.object({
		title: z
			.string()
			.trim()
			.min(1, strings?.titleError)
			.max(100, strings?.titleError)
			.meta({ description: strings?.titleLabel }),
		date: dayKeySchema(strings?.dateError).meta({ description: strings?.dateLabel }),
		mealType: z
			.enum(MEAL_TYPES, strings?.mealTypeError)
			.meta({ description: strings?.mealTypeLabel }),
		ingredients: z.array(ingredientSchema(strings))
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type MealPlanSchema = ReturnType<typeof mealPlanSchema>;

/** Los datos validados por el schema. */
export type MealPlanFormData = z.infer<MealPlanSchema>;
