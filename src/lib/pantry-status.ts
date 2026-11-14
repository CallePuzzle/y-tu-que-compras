// Estado de despensa de UN día del calendario (épica #236, tareas #244 y
// #245): funciones PURAS, sin Paraglide ni imports de servidor, para que las
// pruebe el proyecto `server` de vitest (patrón `grid.ts`). Dado el día (sus
// menús) y el mapa despensa id → cantidad, calcula el estado agregado POR
// PRODUCTO: la necesidad de todas las comidas del día sobre el mismo producto
// se suma ANTES de compararla con la despensa — dos comidas que piden huevos
// son una sola necesidad, no dos consultas sueltas.
//
// Lo consume la vista del detalle del día (el badge de cada ingrediente,
// #244) y el volcado a la lista de compra (`#lib/server/dump.ts`, #245): el
// servidor recalcula el déficit SIEMPRE al volcar — lo que falta no lo decide
// nunca el cliente.
//
// El ingrediente lleva su `pantryItemId` desde la fase 1 (guardar el menú
// garantiza el producto y lo enlaza), así que el cálculo no resuelve
// nombres: los ingredientes SIN producto (`pantryItemId` null — borrar el
// producto de despensa lo desliga con SetNull) cuentan como «falta».

/** El estado de despensa de un producto para el día. */
export type PantryStatus =
	/** Hay suficiente (justo o sobra): la despensa cubre la necesidad del día. */
	| 'enough'
	/** Insuficiente: falta para el día lo que dice el déficit. */
	| 'short'
	/** El ingrediente no está enlazado a ningún producto de despensa. */
	| 'missing';

/** El estado agregado de UN producto del día. */
export interface ProductPantryStatus {
	status: PantryStatus;
	/**
	 * Lo que falta para cubrir el día: `max(0, necesidad − despensa)`, nunca
	 * negativo — lo que sobra no se descuenta. Con «falta», toda la
	 * necesidad: sin producto no hay despensa que la cubra.
	 */
	deficit: number;
}

/** Lo que el cálculo necesita de CADA ingrediente del día. */
export interface StatusIngredient {
	/** Su producto de despensa garantizado al guardar; `null` si no lleva FK. */
	pantryItemId: string | null;
	/** Cuánto pide, en su unidad snapshotada. */
	quantity: number;
}

/** Lo que el cálculo necesita de UN menú del día: sus ingredientes. */
export interface StatusMeal {
	ingredients: ReadonlyArray<StatusIngredient>;
}

/**
 * El estado de despensa de UN día, agregado por producto: la clave del
 * resultado es el `pantryItemId` del ingrediente — y `null` para los que no
 * llevan FK, de modo que la vista consulte CADA ingrediente por su misma
 * clave, con o sin producto, y siempre reciba uno de los tres estados.
 *
 * La necesidad se suma por producto antes de comparar (el mismo producto
 * repetido en dos comidas — o dos veces en la misma — es una sola
 * necesidad) y el déficit es `max(0, necesidad − despensa)`. Un id
 * enlazado que no esté en el mapa del load cuenta como despensa 0: no
 * debería ocurrir (la FK vive en la despensa de la familia y borrar el
 * producto la anula), pero el cálculo es total — sin fila es no tener nada.
 * Los ingredientes sin producto se agregan bajo `null` igualmente: su
 * déficit es todo lo que piden, aunque la vista pinte «falta» sin cifra.
 */
export function dayPantryStatus(
	meals: ReadonlyArray<StatusMeal>,
	pantryQuantities: Record<string, number>
): Map<string | null, ProductPantryStatus> {
	// La necesidad del día por producto: cada ingrediente suma sobre la
	// clave de su producto, `null` incluido.
	const needs = new Map<string | null, number>();
	for (const meal of meals) {
		for (const ingredient of meal.ingredients) {
			needs.set(
				ingredient.pantryItemId,
				(needs.get(ingredient.pantryItemId) ?? 0) + ingredient.quantity
			);
		}
	}

	const statuses = new Map<string | null, ProductPantryStatus>();
	for (const [pantryItemId, need] of needs) {
		// Sin producto no hay fila de despensa que consultar: falta todo lo
		// que pide. Con producto, lo que no esté en el mapa es no tener nada.
		const available = pantryItemId === null ? 0 : (pantryQuantities[pantryItemId] ?? 0);
		const deficit = Math.max(0, need - available);
		statuses.set(pantryItemId, {
			status: pantryItemId === null ? 'missing' : deficit > 0 ? 'short' : 'enough',
			deficit
		});
	}
	return statuses;
}
