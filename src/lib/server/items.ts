import prisma from '$lib/server/prisma.js';
import type { ItemData, Unit } from '$lib/schemas/item.js';

// CRUD de items de una lista (issues #67 y #68), marca de comprado (#69) y
// reorden de los pendientes (#134). Como en `lists.ts`, la familia viaja
// SIEMPRE en los argumentos — es la activa que `requireActiveFamily` dejó
// verificada — y entra en todos los `where` a través de su lista: un item de
// otra familia (o de otra lista) es como si no existiera.

/** Un item tal y como la vista de la lista lo muestra. */
export interface ItemView {
	id: string;
	name: string;
	/** `Decimal(10,3)` en la base; la vista lo lee como `number`. */
	quantity: number;
	/** Valor del enum `Unit` (identificador inglés); la UI lo traduce con `unit_*`. */
	unit: Unit;
	/** Marca de comprado (#69): la UI la conmuta con actualización optimista. */
	purchased: boolean;
}

/** De la fila de Prisma a la vista: el Decimal se aplana a `number`. */
function toItem(row: {
	id: string;
	name: string;
	quantity: unknown;
	unit: Unit;
	purchased: boolean;
}): ItemView {
	return {
		id: row.id,
		name: row.name,
		quantity: Number(row.quantity),
		unit: row.unit,
		purchased: row.purchased
	};
}

/**
 * Los items de la lista, en su orden visual: primero los pendientes, luego
 * los comprados (#69: separación de comprados vs pendientes también sin JS);
 * dentro de cada grupo manda el `order` y después la antigüedad.
 */
export async function listItems(familyId: string, listId: string): Promise<ItemView[]> {
	const rows = await prisma.item.findMany({
		where: { listId, list: { organizationId: familyId } },
		orderBy: [{ purchased: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
		select: { id: true, name: true, quantity: true, unit: true, purchased: true }
	});
	return rows.map(toItem);
}

/**
 * Crea un item en una lista DE LA FAMILIA. `null` si la lista no existe ahí
 * (id ajeno o ya borrado): sin revelar si vive en otra familia. El `order` lo
 * calcula el SERVIDOR (el schema no trae default: «nadie inserta sin decir
 * dónde»), con el máximo de la lista + 1, dentro de la misma transacción que
 * autoriza la lista.
 */
export async function createItem(
	familyId: string,
	listId: string,
	data: ItemData
): Promise<ItemView | null> {
	return prisma.$transaction(async (tx) => {
		// La lista PRIMERO y CON LOCK (issue #108): dos altas concurrentes en
		// la misma lista se serializan, así que el `max(order) + 1` de abajo
		// no repite posición. `null` si la lista no existe ahí (id ajeno o ya
		// borrado): sin revelar si vive en otra familia. El `order` lo
		// calcula el SERVIDOR (el schema no trae default: «nadie inserta sin
		// decir dónde»).
		const list = await tx.$queryRaw<Array<{ id: string }>>`
			SELECT "id"
			FROM "list"
			WHERE "id" = ${listId} AND "organizationId" = ${familyId}
			FOR UPDATE
		`;
		if (list.length === 0) {
			return null;
		}
		const listaId = list[0].id;

		const { _max } = await tx.item.aggregate({
			where: { listId: listaId },
			_max: { order: true }
		});

		const row = await tx.item.create({
			data: {
				listId: listaId,
				name: data.name,
				quantity: data.quantity,
				unit: data.unit,
				order: (_max.order ?? -1) + 1
			},
			select: { id: true, name: true, quantity: true, unit: true, purchased: true }
		});
		return toItem(row);
	});
}

/**
 * Actualiza un item de la lista. `false` si no hay item con ese id EN ESA
 * LISTA (y la lista, en esa familia): la pertenencia va en el `where` del
 * `updateMany`, no en una comprobación previa aparte — sin ventana de carrera
 * entre el check y el write, y sin posibilidad de tocar un item ajeno por un
 * id rancio.
 */
export async function updateItem(
	familyId: string,
	listId: string,
	id: string,
	data: ItemData
): Promise<boolean> {
	const result = await prisma.item.updateMany({
		where: { id, listId, list: { organizationId: familyId } },
		data: { name: data.name, quantity: data.quantity, unit: data.unit }
	});
	return result.count > 0;
}

/**
 * Borra un item de la lista; `false` si ya no estaba (doble envío), era de
 * otra lista o de otra familia.
 */
export async function deleteItem(familyId: string, listId: string, id: string): Promise<boolean> {
	const result = await prisma.item.deleteMany({
		where: { id, listId, list: { organizationId: familyId } }
	});
	return result.count > 0;
}

/**
 * Marca o desmarca el comprado de un item (#69): el toggle que la UI conmuta
 * con actualización optimista. El valor NUEVO viaja explícito (no se alterna
 * en el servidor): así dos miembros que marcan a la vez acaban en el estado
 * del último envío, sin leer-then-write. `false` si no hay item con ese id EN
 * ESA LISTA (y la lista, en esa familia), igual que `updateItem`: la
 * pertenencia va en el `where` del `updateMany`, sin ventana de carrera.
 */
export async function setItemPurchased(
	familyId: string,
	listId: string,
	id: string,
	purchased: boolean
): Promise<boolean> {
	const result = await prisma.item.updateMany({
		where: { id, listId, list: { organizationId: familyId } },
		data: { purchased }
	});
	return result.count > 0;
}

/**
 * Aplica el orden nuevo de los PENDIENTES de la lista (#134, drag-to-swap
 * con Swapy): los ids del payload, en el orden que traen, se renumeran 1..n
 * y los comprados conservan su orden relativo detrás — la vista agrupa por
 * `purchased` y dentro de cada grupo manda el `order`, así que ninguno se
 * mueve de su grupo. `false` si la lista no existe en la familia o algún id
 * es ajeno (otra lista u otra familia), rancio o repetido: nada se toca, y
 * el cliente revierte su optimismo.
 *
 * En UNA transacción y con la lista CON LOCK (issue #108, patrón
 * `createItem`): serializa el reorden con altas y re-añadidos concurrentes,
 * que calculan el max + 1 detrás del mismo lock. Los items se bloquean en el
 * mismo orden en que `finalizePurchase` lee los comprados: ninguna pareja de
 * transacciones bloquea filas en orden inverso.
 */
export async function reorderItems(
	familyId: string,
	listId: string,
	orderedIds: string[]
): Promise<boolean> {
	return prisma.$transaction(async (tx) => {
		const list = await tx.$queryRaw<Array<{ id: string }>>`
			SELECT "id"
			FROM "list"
			WHERE "id" = ${listId} AND "organizationId" = ${familyId}
			FOR UPDATE
		`;
		if (list.length === 0) {
			return false;
		}
		const listaId = list[0].id;

		const filas = await tx.$queryRaw<Array<{ id: string }>>`
			SELECT "id"
			FROM "item"
			WHERE "listId" = ${listaId}
			ORDER BY "order" ASC, "createdAt" ASC, "id" ASC
			FOR UPDATE
		`;

		const presentes = new Set(filas.map((fila) => fila.id));
		if (
			new Set(orderedIds).size !== orderedIds.length ||
			!orderedIds.every((id) => presentes.has(id))
		) {
			return false;
		}

		// Ya traen el orden relativo actual (el `ORDER BY` de arriba), así que
		// detrás del payload conservan su sitio, igual que en `reorderPantryItems`.
		const enviados = new Set(orderedIds);
		const nuevo = [
			...orderedIds,
			...filas.map((fila) => fila.id).filter((id) => !enviados.has(id))
		];
		for (const [indice, id] of nuevo.entries()) {
			await tx.item.updateMany({
				where: { id, listId: listaId },
				data: { order: indice + 1 }
			});
		}
		return true;
	});
}
