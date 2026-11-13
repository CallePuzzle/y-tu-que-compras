import { m } from '#lib/paraglide/messages.js';
import type { MealTypeValue } from '#lib/schemas/mealplan.js';

/**
 * Etiquetas de los tipos de comida del menú (épica #212): los valores del
 * catálogo NUNCA se muestran tal cual (son identificadores estables en
 * inglés), los traduce Paraglide con las claves `meal_*` — las que el
 * comentario del schema promete. Función y no constante: el mapa se
 * construye EN RENDER, no en scope de módulo (regla i18n de la librería).
 * El `Record` exige el catálogo entero en compilación.
 */
export function mealTypeLabels(): Record<MealTypeValue, string> {
	return {
		breakfast: m.meal_breakfast(),
		lunch: m.meal_lunch(),
		dinner: m.meal_dinner(),
		other: m.meal_other()
	};
}
