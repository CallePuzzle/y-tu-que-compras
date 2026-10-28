import { m } from '$lib/paraglide/messages.js';
import type { Unit } from '$lib/schemas/item.js';

/**
 * Etiquetas de las unidades: los valores del enum NUNCA se muestran tal cual
 * (son identificadores estables en inglés), los traduce Paraglide. Función y
 * no constante: el mapa se construye EN RENDER, no en scope de módulo (regla
 * i18n de la librería). El `Record` exige el catálogo entero en compilación.
 */
export function unitLabels(): Record<Unit, string> {
	return {
		unit: m.unit_unit(),
		kilogram: m.unit_kilogram(),
		gram: m.unit_gram(),
		liter: m.unit_liter(),
		milliliter: m.unit_milliliter(),
		package: m.unit_package(),
		can: m.unit_can(),
		dozen: m.unit_dozen()
	};
}
