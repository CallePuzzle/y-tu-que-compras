import { normalizeItemName } from '#lib/normalize-name.js';
import type { Unit } from '#lib/schemas/item.js';

// Autocompletado de nombres de producto (épica #286): los formularios donde se
// escribe un nombre de producto ofrecen en un `<datalist>` los nombres que la
// familia ya conoce (`nameSuggestions` del load) y, al casar lo tecleado con
// uno de ellos, pre-rellenan lo que corresponda (unidad, categoría, enlace a
// despensa). Aquí vive la parte pura (sin Svelte) que comparten: buscar la
// sugerencia por nombre canónico y la regla de #173 para cada campo
// pre-rellenable. La usan el detalle de lista (#283), las recetas (#284) y los
// menús (#285: crear menú en /calendar y asignar receta en /recipes).

/** Lo que un formulario usa de una sugerencia de nombre. */
export interface NameSuggestion {
	name: string;
	unit: Unit;
	categoryId: string | null;
}

/**
 * Índice nombre canónico -> sugerencia. El servidor ya colapsa una por
 * canónico (`listProductNameSuggestions`), así que no hay colisiones: el
 * índice solo evita recorrer la lista en cada tecla.
 */
export function indexNameSuggestions<T extends NameSuggestion>(suggestions: T[]): Map<string, T> {
	return new Map(suggestions.map((suggestion) => [normalizeItemName(suggestion.name), suggestion]));
}

/** Un campo pre-rellenable: su valor y si lo puso la sugerencia (no la persona). */
export interface PrefillField<T> {
	value: T;
	suggested: boolean;
}

/**
 * La regla de #173 aplicada a UN campo (unidad o categoría) tras cada tecla
 * en el nombre:
 *
 * - Hay valor sugerido (`next`) y el campo no está bloqueado por una elección
 *   manual: se aplica y queda marcado como sugerido.
 * - No hay valor sugerido (el nombre dejó de casar, o casa con un producto
 *   sin ese dato) y lo que muestra el campo lo puso la sugerencia: se retira
 *   y vuelve a `fallback` (lo que había antes de sugerir nada).
 * - En otro caso, el campo no se toca: lo elegido a mano nunca se pisa.
 */
export function prefillField<T>(
	field: PrefillField<T>,
	next: T | null | undefined,
	options: { locked: boolean; fallback: T }
): PrefillField<T> {
	if (next !== null && next !== undefined) {
		return options.locked ? field : { value: next, suggested: true };
	}
	return field.suggested ? { value: options.fallback, suggested: false } : field;
}

/**
 * El estado de pre-relleno de UNA fila de ingrediente (recetas, #284): lo que
 * la fila traía al abrirse (su «base») y si su unidad la puso la sugerencia o
 * la eligió la persona. Vive aparte del formulario: no viaja al servidor.
 */
export interface IngredientPrefillState {
	/** Canónico con el que se abrió la fila (`''` en una fila nueva). */
	baseName: string;
	/** Unidad con la que se abrió: a ella vuelve al retirar una sugerencia. */
	baseUnit: Unit;
	/** Enlace a despensa con el que se abrió (`''` = sin enlace). */
	basePantryItemId: string;
	unitSuggested: boolean;
	/** La unidad se eligió a mano (select o conversión del chip): no se pisa. */
	unitManual: boolean;
}

/** Una fila de ingrediente tal y como la lleva el formulario. */
export interface IngredientRow {
	name: string;
	unit: Unit;
	pantryItemId?: string;
}

/** El estado inicial de una fila: su contenido actual es su base. */
export function ingredientPrefillState(row: IngredientRow): IngredientPrefillState {
	return {
		baseName: normalizeItemName(row.name),
		baseUnit: row.unit,
		basePantryItemId: row.pantryItemId ?? '',
		unitSuggested: false,
		unitManual: false
	};
}

/**
 * Cada tecla en el nombre de un ingrediente: casa por nombre canónico con las
 * sugerencias y devuelve la unidad y el enlace a despensa que tocan.
 *
 * - Unidad: la regla de #173 (`prefillField`), con la unidad de la base como
 *   valor al que volver; la elegida a mano nunca se pisa.
 * - Enlace: el `pantryItemId` de la sugerencia, que solo existe si ganó la
 *   despensa (un nombre que solo sale de listas o recetas queda suelto).
 * - Volver al nombre con el que se abrió la fila (corregir una errata al
 *   editar) no sugiere nada y restaura su enlace: la fila ya es ese producto.
 */
export function prefillIngredient<T extends NameSuggestion & { pantryItemId: string | null }>(
	row: IngredientRow,
	state: IngredientPrefillState,
	index: Map<string, T>
): { unit: Unit; pantryItemId: string; state: IngredientPrefillState } {
	const key = normalizeItemName(row.name);
	const isBase = key === state.baseName;
	const suggestion = isBase ? undefined : index.get(key);
	const unit = prefillField({ value: row.unit, suggested: state.unitSuggested }, suggestion?.unit, {
		locked: state.unitManual,
		fallback: state.baseUnit
	});
	return {
		unit: unit.value,
		pantryItemId: isBase ? state.basePantryItemId : (suggestion?.pantryItemId ?? ''),
		state: { ...state, unitSuggested: unit.suggested }
	};
}

/**
 * El estado de pre-relleno de UNA fila de ingrediente de menú (#285): el de
 * receta más su categoría, que el formulario de menú sí lleva (y no lleva
 * enlace a despensa: lo resuelve el servidor al guardar, por nombre y unidad,
 * en `ensurePantryProducts`).
 */
export interface MealIngredientPrefillState extends IngredientPrefillState {
	/** Categoría con la que se abrió la fila (`''` = sin categoría). */
	baseCategoryId: string;
	categorySuggested: boolean;
	/** La categoría se eligió a mano en su select: no se pisa. */
	categoryManual: boolean;
}

/** Una fila de ingrediente de menú tal y como la lleva el formulario. */
export interface MealIngredientRow {
	name: string;
	unit: Unit;
	categoryId?: string;
}

/** El estado inicial de una fila de menú: su contenido actual es su base. */
export function mealIngredientPrefillState(row: MealIngredientRow): MealIngredientPrefillState {
	return {
		...ingredientPrefillState(row),
		baseCategoryId: row.categoryId ?? '',
		categorySuggested: false,
		categoryManual: false
	};
}

/**
 * Cada tecla en el nombre de un ingrediente de menú: la unidad sigue la regla
 * de `prefillIngredient` y la categoría, la misma regla de #173 por separado
 * (una sugerencia sin categoría retira la que ella misma hubiera puesto).
 */
export function prefillMealIngredient<T extends NameSuggestion & { pantryItemId: string | null }>(
	row: MealIngredientRow,
	state: MealIngredientPrefillState,
	index: Map<string, T>
): { unit: Unit; categoryId: string; state: MealIngredientPrefillState } {
	const ingredient = prefillIngredient(row, state, index);
	const key = normalizeItemName(row.name);
	const suggestion = key === state.baseName ? undefined : index.get(key);
	const category = prefillField(
		{ value: row.categoryId ?? '', suggested: state.categorySuggested },
		suggestion?.categoryId,
		{ locked: state.categoryManual, fallback: state.baseCategoryId }
	);
	return {
		unit: ingredient.unit,
		categoryId: category.value,
		state: {
			...state,
			unitSuggested: ingredient.state.unitSuggested,
			categorySuggested: category.suggested
		}
	};
}
