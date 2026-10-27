import prisma from '$lib/server/prisma.js';
import type { Unit } from '$lib/schemas/item.js';

// Consulta de la despensa de la familia (issues #44 y #72). Como en
// `lists.ts`/`items.ts`, la familia viaja SIEMPRE en los argumentos — es la
// activa que `requireActiveFamily` dejó verificada — y entra en el `where`:
// un producto de otra familia es como si no existiera. La escritura (el alta
// al finalizar compra) vive en `purchases.ts`; consumir (#73) y re-añadir
// (#74) llegarán con sus propias tareas.

/** Un producto de la despensa tal y como la vista lo muestra. */
export interface PantryItemView {
	id: string;
	name: string;
	/** `Decimal(10,3)` en la base; la vista lo lee como `number`. */
	quantity: number;
	/** Valor del enum `Unit` (identificador inglés); la UI lo traduce con `unit_*`. */
	unit: Unit;
}

/** De la fila de Prisma a la vista: el Decimal se aplana a `number`. */
function toPantryItem(row: {
	id: string;
	name: string;
	quantity: unknown;
	unit: Unit;
}): PantryItemView {
	return {
		id: row.id,
		name: row.name,
		quantity: Number(row.quantity),
		unit: row.unit
	};
}

/**
 * Los productos de la despensa de la familia, alfabéticos por nombre visible:
 * es el orden en el que se mira «¿queda X?». El nombre es el que puso la
 * PRIMERA compra del producto (`purchases.ts` lo conserva aunque las siguientes
 * lleguen escritas de otra manera); solo su cantidad crece.
 */
export async function listPantryItems(familyId: string): Promise<PantryItemView[]> {
	const rows = await prisma.pantryItem.findMany({
		where: { organizationId: familyId },
		orderBy: { name: 'asc' },
		select: { id: true, name: true, quantity: true, unit: true }
	});
	return rows.map(toPantryItem);
}
