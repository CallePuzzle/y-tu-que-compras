import { UNIT_STEP } from '$lib/pantry-steps.js';
import prisma from '$lib/server/prisma.js';
import type { Unit } from '$lib/schemas/item.js';

// Consulta y ciclo de vida de la despensa de la familia (issues #44, #72,
// #73 y #74). Como en `lists.ts`/`items.ts`, la familia viaja SIEMPRE en los
// argumentos — es la activa que `requireActiveFamily` dejó verificada — y
// entra en el `where`: un producto de otra familia es como si no existiera.
// La otra escritura (el alta al finalizar compra) vive en `purchases.ts`.

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

/**
 * Consume (−) o devuelve (+) UN paso del producto en la despensa (issue #73).
 * El paso lo fija el SERVIDOR con `UNIT_STEP` según la unidad guardada: lo
 * que viaja en el formulario es solo el id y el signo, nunca una cantidad.
 *
 * `false` si el producto ya no está EN ESA FAMILIA (id rancio, borrado por
 * otro miembro o ajeno): la pertenencia va en cada `where`, sin ventana de
 * carrera entre el check y el write.
 *
 * El decremento no puede leer-then-write: dos miembros consumiendo a la vez
 * con `0,3 kg` se lo llevarían dos veces a `0,05`. En su lugar la base aplica
 * el paso sobre el valor comprometido más nuevo (el UPDATE espera al lock de
 * la fila) y el clamp a 0 va JUSTO después, dentro de la misma transacción:
 * quien llegue el último deja la cantidad en 0 y el producto se borra —
 * desaparece al agotarse, sin cantidades negativas ni residuos.
 */
export async function adjustPantryItem(
	familyId: string,
	id: string,
	direction: 1 | -1
): Promise<boolean> {
	return prisma.$transaction(async (tx) => {
		// El paso depende de la unidad GUARDADA, no de la que diga el cliente.
		const row = await tx.pantryItem.findFirst({
			where: { id, organizationId: familyId },
			select: { unit: true }
		});
		if (!row) {
			return false;
		}
		const step = UNIT_STEP[row.unit];

		if (direction > 0) {
			// Devolver un paso (+): el botón que corrige un − equivocado. Los
			// incrementos conmutan, aquí no hay carrera que temer.
			const subida = await tx.pantryItem.updateMany({
				where: { id, organizationId: familyId },
				data: { quantity: { increment: step } }
			});
			return subida.count > 0;
		}

		// Consumir (−): `updateMany` no lanza si otro miembro borró la fila
		// entre el `findFirst` y aquí — devuelve 0 y es el mismo «ya no está».
		const bajada = await tx.pantryItem.updateMany({
			where: { id, organizationId: familyId },
			data: { quantity: { decrement: step } }
		});
		if (bajada.count === 0) {
			return false;
		}

		// Clamp atómico con el decremento (misma transacción): si otro consumo
		// concurrente ya había pasado la cantidad por debajo de cero, aquí se
		// endereza a 0 y el producto muere. Nadie llega a VER un negativo: la
		// transacción no se ha comprometido con el valor en manos.
		const clamp = await tx.pantryItem.updateMany({
			where: { id, organizationId: familyId, quantity: { lte: 0 } },
			data: { quantity: 0 }
		});
		if (clamp.count > 0) {
			await tx.pantryItem.deleteMany({
				where: { id, organizationId: familyId, quantity: 0 }
			});
		}
		return true;
	});
}
