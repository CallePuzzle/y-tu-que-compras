import { normalizeItemName } from '#lib/normalize-name.js';
import type { Unit } from '#lib/schemas/item.js';

/**
 * Conversiones exactas entre unidades (épica #232, tarea #240): la pieza
 * compartida que detecta que lo tecleado en una fila (ingrediente de receta,
 * item…) coincide con un producto de despensa en OTRA unidad y propone la
 * conversión cuando es EXACTA en los 3 decimales de la columna
 * `DECIMAL(10,3)`. 100% cliente: `normalizeItemName` ya era client-safe (lo
 * usa el alta rápida) y aquí no hay Paraglide ni imports de servidor — el
 * módulo es puro y lo prueba el proyecto `server` de vitest, como
 * `format.ts`. Lo reutilizan las historias 3 y 4 de la épica.
 */

/** La forma mínima que el conflicto necesita de un producto de despensa. */
export interface PantryProduct {
	id: string;
	name: string;
	unit: Unit;
}

/**
 * La conversión que el chip propone aplicar: la unidad destino (la del
 * producto de despensa), la cantidad YA convertida y el producto que la
 * motiva — el consumidor decide qué hace con cada cosa (el modal de recetas
 * adapta la fila y la enlaza, como el autocompletado de #239).
 */
export interface UnitConversion {
	unit: Unit;
	quantity: number;
	pantryItemId: string;
}

/**
 * La matriz convertible, como pares [numerador, denominador] de números
 * enteros: multiplicar por 1000 o dividir entre 1000 (kg↔g, L↔ml) y
 * multiplicar por 12 (docena→ud). El sentido IMPORTA: kg→g y docena→ud son
 * siempre exactas (escalar no pierde decimales), pero g→kg solo cuando la
 * cantidad es múltiplo de 1000 milésimas y ud→docena ni eso (1 ud son
 * 0,083… docenas): los pares que no están aquí (ud→docena, paquete, lata y
 * cualquier cruce sin pivote) no convierten y quedan en aviso informativo
 * sin botón. Enteros a propósito: 0.001 no es exacto en binario y
 * `250000 * 0.001` daría 250.00000000000003, echando a perder el 250 g.
 */
const CONVERSIONS: Partial<Record<Unit, Partial<Record<Unit, [number, number]>>>> = {
	kilogram: { gram: [1000, 1] },
	gram: { kilogram: [1, 1000] },
	liter: { milliliter: [1000, 1] },
	milliliter: { liter: [1, 1000] },
	dozen: { unit: [12, 1] }
};

/**
 * La cantidad convertida de una unidad a otra, o `null` si el par no es
 * convertible o el resultado no cabe EXACTO en `DECIMAL(10,3)` (múltiplo de
 * 0.001): aplicarlo redondearía por su cuenta o moriría en el schema
 * (`quantitySchema`, issue #107). Con el par fuera de la matriz (`ud→docena`,
 * `paquete`, `lata`…) también `null` — el llamador distingue «no convertible»
 * de «convertible» para pintar el aviso con o sin botón. La misma unidad
 * devuelve la cantidad normalizada a 3 decimales (mismo cierre flotante que
 * `roundQuantity` de `pantry-steps.ts`), y lo no finito o no positivo no
 * convierte: la fila puede estar a medias mientras se teclea.
 */
export function convertQuantity(quantity: number, from: Unit, to: Unit): number | null {
	if (!Number.isFinite(quantity) || quantity <= 0) {
		return null;
	}
	if (from === to) {
		return Math.round(quantity * 1000) / 1000;
	}
	const pair = CONVERSIONS[from]?.[to];
	if (!pair) {
		return null;
	}
	const [numerator, denominator] = pair;
	// En milésimas y con enteros: `Math.round` elimina el polvo de flotante de
	// lo tecleado y el módulo decide la exactitud sin error de coma flotante.
	const quantityMilli = Math.round(quantity * 1000);
	const convertedMilli = quantityMilli * numerator;
	if (convertedMilli % denominator !== 0) {
		return null;
	}
	return convertedMilli / denominator / 1000;
}

/**
 * Los productos de despensa con el MISMO nombre canónico (`normalizeItemName`:
 * «arroz» y «Arroz» empatan) pero en OTRA unidad que la fila — el conflicto
 * que avisa el chip. El nombre va SIN normalizar (lo normaliza la función,
 * igual que hace la búsqueda de items) y el producto YA enlazado puede salir:
 * es justo el caso «la unidad se cambió a mano después» que la conversión
 * deshace. Si el producto vive en varias unidades, salen TODAS las opciones.
 */
export function findUnitConflicts(
	name: string,
	unit: Unit,
	pantryProducts: readonly PantryProduct[]
): PantryProduct[] {
	const normalizedName = normalizeItemName(name);
	if (!normalizedName) {
		return [];
	}
	return pantryProducts.filter(
		(product) => product.unit !== unit && normalizeItemName(product.name) === normalizedName
	);
}
