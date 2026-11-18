import { normalizeItemName } from '#lib/normalize-name.js';
import type { Unit } from '#lib/schemas/item.js';

// Autocompletado de nombres en el detalle de lista (issue #283, épica #286):
// el alta rápida y el modal de editar ofrecen en un `<datalist>` los nombres
// que la familia ya conoce (`nameSuggestions` del load) y, al casar lo tecleado
// con uno de ellos, pre-rellenan unidad y categoría. Aquí vive la parte pura
// (sin Svelte) que comparten los dos formularios: buscar la sugerencia por
// nombre canónico y la regla de #173 para cada campo pre-rellenable.

/** Lo que un formulario de items usa de una sugerencia de nombre. */
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
