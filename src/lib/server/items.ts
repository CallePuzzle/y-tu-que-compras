import { Prisma } from '#lib/generated/prisma/client.js';
import prisma from '#lib/server/prisma.js';
import type { ItemData, Unit } from '#lib/schemas/item.js';

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
	/** Categoría del item (checklist #172): el chip de la fila la muestra. */
	categoryId: string | null;
	/** Nombre visible de esa categoría, para pintar el chip sin otra consulta. */
	categoryName: string | null;
	/** Marca de comprado (#69): la UI la conmuta con actualización optimista. */
	purchased: boolean;
}

/** De la fila de Prisma a la vista: el Decimal se aplana a `number`. */
function toItem(row: {
	id: string;
	name: string;
	quantity: unknown;
	unit: Unit;
	categoryId: string | null;
	category: { name: string } | null;
	purchased: boolean;
}): ItemView {
	return {
		id: row.id,
		name: row.name,
		quantity: Number(row.quantity),
		unit: row.unit,
		categoryId: row.categoryId,
		categoryName: row.category?.name ?? null,
		purchased: row.purchased
	};
}

/**
 * Un item tal y como lo devuelve la API pública (tarea #268): la vista de la
 * UI más su `order`, que la API deja escribir en el PATCH y por tanto expone
 * al leer. La UI no lo usa (no reordena items), así que `ItemView` no lo lleva.
 */
export interface ApiItemView extends ItemView {
	/** Posición dentro de su grupo (pendientes/comprados) de la lista. */
	order: number;
}

/** Columnas de un item para las vistas: las de `ItemView` más el `order`. */
const ITEM_SELECT = {
	id: true,
	name: true,
	quantity: true,
	unit: true,
	categoryId: true,
	category: { select: { name: true } },
	purchased: true,
	order: true
} as const;

/** De la fila de Prisma a la vista de la API: la de la UI más el `order`. */
function toApiItem(row: Parameters<typeof toItem>[0] & { order: number }): ApiItemView {
	return { ...toItem(row), order: row.order };
}

/**
 * Las filas de los items de la lista, en su orden visual: primero los
 * pendientes, luego los comprados (#69: separación de comprados vs pendientes
 * también sin JS); dentro de cada grupo manda el `order` y después la
 * antigüedad.
 */
function findListItems(familyId: string, listId: string) {
	return prisma.item.findMany({
		where: { listId, list: { organizationId: familyId } },
		orderBy: [{ purchased: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
		select: ITEM_SELECT
	});
}

/** Los items de la lista para la UI, en su orden visual (ver `findListItems`). */
export async function listItems(familyId: string, listId: string): Promise<ItemView[]> {
	return (await findListItems(familyId, listId)).map(toItem);
}

/** Los items de la lista para la API (con `order`), en el mismo orden visual. */
export async function listApiItems(familyId: string, listId: string): Promise<ApiItemView[]> {
	return (await findListItems(familyId, listId)).map(toApiItem);
}

/**
 * Un item de la lista por id, con su `order` (API pública, tarea #268): `null`
 * si no hay item con ese id EN ESA LISTA y la lista no es de la familia —
 * mismo `where` que `updateItem`, así que un id ajeno es «como si no
 * existiera». La API lo usa para mezclar el PATCH parcial con lo guardado y
 * para devolver el item tras crearlo o editarlo.
 */
export async function getItem(
	familyId: string,
	listId: string,
	id: string
): Promise<ApiItemView | null> {
	const row = await prisma.item.findFirst({
		where: { id, listId, list: { organizationId: familyId } },
		select: ITEM_SELECT
	});
	return row ? toApiItem(row) : null;
}

/**
 * Resuelve la categoría del item (checklist #172): el id de UNA categoría de
 * la familia, o `null` si no viaja o ya no está en ella. La UI solo ofrece
 * categorías de la familia, así que un id que no cuadra (rancio: la borraron
 * mientras se rellenaba el formulario, o un id inventado) se guarda como «sin
 * categoría» — el mismo efecto que el `SetNull` del borrado de categorías —
 * y sin 500 por violar la FK.
 */
async function resolveCategoryId(
	db: Prisma.TransactionClient,
	familyId: string,
	categoryId: string | undefined
): Promise<string | null> {
	if (!categoryId) {
		return null;
	}
	const category = await db.category.findFirst({
		where: { id: categoryId, organizationId: familyId },
		select: { id: true }
	});
	return category?.id ?? null;
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
): Promise<ApiItemView | null> {
	return prisma.$transaction(async (tx) => {
		// La lista PRIMERO y CON LOCK (issue #108): dos altas concurrentes en
		// la misma lista se serializan, así que el `max(order) + 1` de abajo
		// no repite posición. `null` si la lista no existe ahí (id ajeno o ya
		// borrado): sin revelar si vive en otra familia. El `order` lo
		// calcula el SERVIDOR (el schema no trae default: «nadie inserta sin
		// decir dónde»).
		const lockedList = await tx.$queryRaw<Array<{ id: string }>>`
			SELECT "id"
			FROM "list"
			WHERE "id" = ${listId} AND "organizationId" = ${familyId}
			FOR UPDATE
		`;
		if (lockedList.length === 0) {
			return null;
		}

		const { _max } = await tx.item.aggregate({
			where: { listId: lockedList[0].id },
			_max: { order: true }
		});

		// La categoría (checklist #172) se resuelve DENTRO de la transacción,
		// igual que la lista: solo vale una de la familia; si no, sin categoría.
		const categoryId = await resolveCategoryId(tx, familyId, data.categoryId);

		const row = await tx.item.create({
			data: {
				listId: lockedList[0].id,
				name: data.name,
				quantity: data.quantity,
				unit: data.unit,
				categoryId,
				order: (_max.order ?? -1) + 1
			},
			select: ITEM_SELECT
		});
		return toApiItem(row);
	});
}

/**
 * Actualiza un item de la lista. `false` si no hay item con ese id EN ESA
 * LISTA (y la lista, en esa familia): la pertenencia va en el `where` del
 * `updateMany`, no en una comprobación previa aparte — sin ventana de carrera
 * entre el check y el write, y sin posibilidad de tocar un item ajeno por un
 * id rancio. La categoría (checklist #172) se sustituye entera, como el resto
 * de campos: «Sin categoría» en el select borra la que tuviera.
 */
export async function updateItem(
	familyId: string,
	listId: string,
	id: string,
	data: ItemData
): Promise<boolean> {
	const categoryId = await resolveCategoryId(prisma, familyId, data.categoryId);
	const result = await prisma.item.updateMany({
		where: { id, listId, list: { organizationId: familyId } },
		data: { name: data.name, quantity: data.quantity, unit: data.unit, categoryId }
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
 * Fija la posición (`order`) de un item dentro de su lista (API pública,
 * tarea #268): la UI no reordena items, pero la API deja a una integración
 * colocarlos. El valor viaja explícito y se escribe tal cual — sin reescribir
 * el resto de la lista: dos items con el mismo `order` se desempatan por
 * antigüedad, igual que en `listItems`. `false` si no hay item con ese id EN
 * ESA LISTA (y la lista, en esa familia), con la pertenencia en el `where`.
 */
export async function setItemOrder(
	familyId: string,
	listId: string,
	id: string,
	order: number
): Promise<boolean> {
	const result = await prisma.item.updateMany({
		where: { id, listId, list: { organizationId: familyId } },
		data: { order }
	});
	return result.count > 0;
}
