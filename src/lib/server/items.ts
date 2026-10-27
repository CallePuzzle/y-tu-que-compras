import prisma from '$lib/server/prisma.js';
import type { ItemData, Unit } from '$lib/schemas/item.js';

// CRUD de items de una lista (issues #67 y #68). Como en `lists.ts`, la
// familia viaja SIEMPRE en los argumentos — es la activa que
// `requireActiveFamily` dejó verificada — y entra en todos los `where` a
// través de su lista: un item de otra familia (o de otra lista) es como si
// no existiera.

/** Un item tal y como la vista de la lista lo muestra. */
export interface ItemView {
	id: string;
	name: string;
	/** `Decimal(10,3)` en la base; la vista lo lee como `number`. */
	quantity: number;
	/** Valor del enum `Unit` (identificador inglés); la UI lo traduce con `unit_*`. */
	unit: Unit;
}

/** De la fila de Prisma a la vista: el Decimal se aplana a `number`. */
function toItem(row: { id: string; name: string; quantity: unknown; unit: Unit }): ItemView {
	return { id: row.id, name: row.name, quantity: Number(row.quantity), unit: row.unit };
}

/** Los items de la lista, en su orden visual: primero el `order`, luego la antigüedad. */
export async function listItems(familyId: string, listId: string): Promise<ItemView[]> {
	const rows = await prisma.item.findMany({
		where: { listId, list: { organizationId: familyId } },
		orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
		select: { id: true, name: true, quantity: true, unit: true }
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
		const list = await tx.list.findFirst({
			where: { id: listId, organizationId: familyId },
			select: { id: true }
		});
		if (!list) {
			return null;
		}

		const { _max } = await tx.item.aggregate({
			where: { listId: list.id },
			_max: { order: true }
		});

		const row = await tx.item.create({
			data: {
				listId: list.id,
				name: data.name,
				quantity: data.quantity,
				unit: data.unit,
				order: (_max.order ?? -1) + 1
			},
			select: { id: true, name: true, quantity: true, unit: true }
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
