import type { Unit } from '$lib/schemas/item.js';

/**
 * El paso de consumo por unidad (issue #73): cuánto cambia la cantidad de un
 * producto de la despensa con cada click en −/+ (consumir / devolver). Es un
 * acuerdo de dominio compartido por el servidor — que fija el paso real al
 * ajustar, sin fiarse de lo que viaje en el formulario — y la vista, que lo
 * necesita para el ajuste optimista y las etiquetas de los botones.
 *
 * Propuesta de la issue: ud/paquete/lata/docena = 1, kg/L = 0,25 y g/ml = 100
 * — pasos que la gente pide al super («un paquete más», «un cuarto de kilo
 * menos»). El mapa es exhaustivo por el tipo: añadir una unidad al catálogo
 * sin su paso no compila. Sin conversión entre unidades (limitación conocida
 * de la épica #32): 1 kg y 500 g siguen siendo dos entradas distintas.
 */
export const UNIT_STEP: Record<Unit, number> = {
	unit: 1,
	kilogram: 0.25,
	gram: 100,
	liter: 0.25,
	milliliter: 100,
	package: 1,
	can: 1,
	dozen: 1
};

/**
 * Redondea a los 3 decimales de la columna `DECIMAL(10,3)`: la aritmética de
 * la vista (base ± paso) va en flotante y `0.3 - 0.25` pintaría
 * `0.04999999999999999` en el badge sin este cierre, que deja la cantidad
 * optimista igual a la que guardará la base.
 */
export function redondearCantidad(quantity: number): number {
	return Math.round(quantity * 1000) / 1000;
}
