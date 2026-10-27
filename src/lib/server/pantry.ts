import { UNIT_STEP } from '$lib/pantry-steps.js';
import prisma from '$lib/server/prisma.js';
import { normalizeItemName } from '$lib/server/purchases.js';
import type { ReaddData } from '$lib/schemas/pantry.js';
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

/** Cómo acabó un re-añadido a la compra. */
export type ReaddOutcome =
	/** El producto entró (o sumó) en la lista y la despensa quedó ajustada. */
	| 'added'
	/** El producto de despensa ya no está en esa familia (id ajeno o rancio). */
	| 'pantry-gone'
	/** La lista destino no existe en esa familia (id ajeno o ya borrada). */
	| 'list-gone';

/**
 * Re-añade un producto de la despensa a una lista DE LA FAMILIA (issues #46 y
 * #74): la lista destino la elige el usuario (puede ser distinta a la de la
 * última compra) y la despensa se ajusta según `pantryMode` — dejar igual,
 * fijar una cantidad nueva o quitar el producto. Todo en UNA transacción: o
 * entra en la lista y se ajusta la despensa, o no queda rastro de nada.
 *
 * Si en la lista ya hay un item PENDIENTE equivalente (mismo nombre
 * normalizado y misma unidad), la cantidad se SUMA sobre él — los comprados
 * no se tocan: ya se compraron — y su nombre escrito se conserva. Si no lo
 * hay, se crea uno nuevo al final de la lista con el nombre canónico de la
 * despensa (el de la primera compra), que es el que la familia reconoce.
 */
export async function readdPantryItem(
	familyId: string,
	pantryItemId: string,
	data: ReaddData
): Promise<ReaddOutcome> {
	return prisma.$transaction(async (tx) => {
		// Producto ajeno o ya consumido por otro miembro mientras se abría el
		// modal: «no existe», sin revelar si vive en otra familia.
		const producto = await tx.pantryItem.findFirst({
			where: { id: pantryItemId, organizationId: familyId },
			select: { id: true, name: true, normalizedName: true, unit: true }
		});
		if (!producto) {
			return 'pantry-gone';
		}

		// Lista inexistente o ajena: id rancio o de otra familia — «no existe»
		// en ambos casos, como en `finalizePurchase`.
		const lista = await tx.list.findFirst({
			where: { id: data.listId, organizationId: familyId },
			select: { id: true }
		});
		if (!lista) {
			return 'list-gone';
		}

		// ¿Hay pendiente equivalente? Mismo nombre normalizado (los acentos y
		// las mayúsculas no hacen al producto) y misma unidad — la unidad va
		// en el `where` y el nombre se compara canónico a canónico.
		const pendientes = await tx.item.findMany({
			where: { listId: lista.id, purchased: false, unit: producto.unit },
			select: { id: true, name: true }
		});
		const equivalente = pendientes.find(
			(row) => normalizeItemName(row.name) === producto.normalizedName
		);

		// La suma lleva `purchased: false` en el `where`: si otro miembro
		// marcó el equivalente como comprado mientras tanto, no se toca y se
		// crea un item nuevo (count 0).
		const suma = equivalente
			? await tx.item.updateMany({
					where: { id: equivalente.id, purchased: false },
					data: { quantity: { increment: data.quantity } }
				})
			: { count: 0 };

		if (suma.count === 0) {
			// El `order` lo calcula el SERVIDOR, como en `createItem`: al final
			// de la lista.
			const { _max } = await tx.item.aggregate({
				where: { listId: lista.id },
				_max: { order: true }
			});
			await tx.item.create({
				data: {
					listId: lista.id,
					name: producto.name,
					quantity: data.quantity,
					unit: producto.unit,
					order: (_max.order ?? -1) + 1
				}
			});
		}

		// El ajuste de despensa elegido en el modal, sobre la pertenencia en
		// el `where`: si otro miembro lo consumió a cero mientras tanto, no
		// hay nada que fijar ni quitar — el producto ya entró en la lista.
		if (data.pantryMode === 'set') {
			await tx.pantryItem.updateMany({
				where: { id: producto.id, organizationId: familyId },
				data: { quantity: data.newQuantity }
			});
		} else if (data.pantryMode === 'remove') {
			await tx.pantryItem.deleteMany({
				where: { id: producto.id, organizationId: familyId }
			});
		}

		return 'added';
	});
}
