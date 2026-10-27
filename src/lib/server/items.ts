import prisma from '$lib/server/prisma.js';
import type { ItemData, Unit } from '$lib/schemas/item.js';

// CRUD de items de una lista (issues #67 y #68) y marca de comprado (#69).
// Como en `lists.ts`, la familia viaja SIEMPRE en los argumentos — es la
// activa que `requireActiveFamily` dejó verificada — y entra en todos los
// `where` a través de su lista: un item de otra familia (o de otra lista) es
// como si no existiera.

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
