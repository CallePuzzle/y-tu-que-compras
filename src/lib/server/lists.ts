import prisma from '$lib/server/prisma.js';
import type { ListData } from '$lib/schemas/list.js';

// CRUD de listas de la compra (issues #65 y #66). La familia viaja SIEMPRE en
// los argumentos: es la activa que `requireActiveFamily` dejó verificada en el
// load/acción, y todas las consultas la llevan en el `where` — una lista de
// otra familia es como si no existiera (criterio de aceptación de la #66).

/** Una lista tal y como la vista de listas la muestra. */
export interface ListView {
	id: string;
	name: string;
	/** Nombre de color daisyUI (catálogo `LIST_COLORS`); la UI lo traduce a estilos. */
	color: string;
	/** Nombre de icono lucide (catálogo `LIST_ICONS`); la UI lo traduce a componente. */
	icon: string;
	/** Número de items de la lista (el contador del listado, issue #68). */
	itemCount: number;
	/** Items pendientes de comprar (el contador del listado, issue #69). */
	pendingCount: number;
}

const LIST_SELECT = {
	id: true,
	name: true,
	color: true,
	icon: true,
	_count: { select: { items: true } }
} as const;

/** De la fila con `_count` a la vista: los contadores se aplanan a la vista. */
function toListView(
	list: {
		id: string;
		name: string;
		color: string;
		icon: string;
		_count: { items: number };
	},
	pendingCount: number
): ListView {
	const { _count, ...rest } = list;
	return { ...rest, itemCount: _count.items, pendingCount };
}

/** Las listas de la familia, por orden de creación (las primeras arriba). */
export async function listLists(familyId: string): Promise<ListView[]> {
	// Prisma no puede contar dos veces la misma relación en un `select`
	// (total y filtrado), así que los pendientes van en una segunda query
	// agrupada por lista: una fila por lista con items pendientes, no una por
	// item. El filtro de familia va también en el `groupBy`.
	const [lists, pendientes] = await Promise.all([
		prisma.list.findMany({
			where: { organizationId: familyId },
			select: LIST_SELECT,
			orderBy: { createdAt: 'asc' }
		}),
		prisma.item.groupBy({
			by: ['listId'],
			where: { list: { organizationId: familyId }, purchased: false },
			_count: { _all: true }
		})
	]);

	const pendientesPorLista = new Map(pendientes.map((row) => [row.listId, row._count._all]));
	return lists.map((list) => toListView(list, pendientesPorLista.get(list.id) ?? 0));
}

/**
 * Una lista de la familia por id, o `null` si no existe EN ESA FAMILIA (un id
 * ajeno es «no existe»: no se revela si vive en otra familia).
 */
export async function getList(familyId: string, id: string): Promise<ListView | null> {
	const list = await prisma.list.findFirst({
		where: { id, organizationId: familyId },
		select: LIST_SELECT
	});
	if (!list) {
		return null;
	}
	const pendingCount = await prisma.item.count({ where: { listId: id, purchased: false } });
	return toListView(list, pendingCount);
}

/** Crea una lista en la familia con los datos ya validados por `listSchema`. */
export async function createList(
	familyId: string,
	data: ListData
): Promise<Omit<ListView, 'itemCount' | 'pendingCount'>> {
	return prisma.list.create({
		data: { organizationId: familyId, name: data.name, color: data.color, icon: data.icon },
		select: { id: true, name: true, color: true, icon: true }
	});
}

/**
 * Actualiza una lista de la familia. `false` si no hay lista con ese id EN ESA
 * FAMILIA: la pertenencia va en el `where` del `updateMany`, no en una
 * comprobación previa aparte — sin ventana de carrera entre el check y el
 * write, y sin posibilidad de tocar una lista ajena por un id rancio.
 */
export async function updateList(familyId: string, id: string, data: ListData): Promise<boolean> {
	const result = await prisma.list.updateMany({
		where: { id, organizationId: familyId },
		data: { name: data.name, color: data.color, icon: data.icon }
	});
	return result.count > 0;
}

/**
 * Borra una lista de la familia; `false` si ya no estaba (doble envío) o era
 * de otra familia. Sus items mueren en cascada por la FK (issue #67).
 */
export async function deleteList(familyId: string, id: string): Promise<boolean> {
	const result = await prisma.list.deleteMany({
		where: { id, organizationId: familyId }
	});
	return result.count > 0;
}
