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
}

/** Las listas de la familia, por orden de creación (las primeras arriba). */
export async function listLists(familyId: string): Promise<ListView[]> {
	return prisma.list.findMany({
		where: { organizationId: familyId },
		select: { id: true, name: true, color: true, icon: true },
		orderBy: { createdAt: 'asc' }
	});
}

/** Crea una lista en la familia con los datos ya validados por `listSchema`. */
export async function createList(familyId: string, data: ListData): Promise<ListView> {
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
 * de otra familia. Sus items colgarán de ella por FK y morirán en cascada
 * cuando existan (issue #67); hoy la lista va sola.
 */
export async function deleteList(familyId: string, id: string): Promise<boolean> {
	const result = await prisma.list.deleteMany({
		where: { id, organizationId: familyId }
	});
	return result.count > 0;
}
