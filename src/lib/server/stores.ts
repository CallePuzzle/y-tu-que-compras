import { Prisma } from '#lib/generated/prisma/client.js';
import { normalizeItemName } from '#lib/normalize-name.js';
import type { StoreData } from '#lib/schemas/store.js';
import prisma from '#lib/server/prisma.js';

// CRUD de establecimientos de la familia (user story #181, épica #177). La
// familia viaja SIEMPRE en los argumentos: es la activa que
// `requireActiveFamily` dejó verificada en el load/acción, y todas las
// consultas la llevan en el `where` — un establecimiento de otra familia es
// como si no existiera (mismo criterio que `lists.ts` y `categories.ts`). Son
// escritura para cualquier miembro (issue #111): sin checks de rol. A diferencia
// de las categorías no hay orden manual: la vista los muestra por orden de
// creación, como las listas.

/** Un establecimiento tal y como la vista lo muestra. */
export interface StoreView {
	id: string;
	name: string;
}

/** Otro establecimiento de la familia ya usa ese nombre (tras normalizar). */
export class StoreExistsError extends Error {
	constructor() {
		super('Store name already exists in this family');
		this.name = 'StoreExistsError';
	}
}

const STORE_SELECT = { id: true, name: true } as const;

/** ¿Es el P2002 de Postgres? La tabla `store` solo tiene un índice único — (familia, nombre normalizado) —, así que el código basta. */
function isUniqueViolation(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Los establecimientos de la familia, por orden de creación (los primeros arriba). */
export async function listStores(familyId: string): Promise<StoreView[]> {
	return prisma.store.findMany({
		where: { organizationId: familyId },
		select: STORE_SELECT,
		orderBy: { createdAt: 'asc' }
	});
}

/**
 * Crea un establecimiento en la familia con el nombre ya validado por
 * `storeSchema`.
 *
 * El duplicado se detecta en la base: el índice único (familia, nombre
 * normalizado) rechaza «Mercadona» si ya hay «mercadona», « MERCADONA » o
 * cualquier variante que `normalizeItemName` haga canónicamente igual — y es a
 * prueba de carrera, sin ventana entre un check previo y el write. El P2002 se
 * traduce a `StoreExistsError` para que la acción lo convierta en el mensaje
 * de la UI, sin filtrar el error crudo de Prisma.
 */
export async function createStore(familyId: string, data: StoreData): Promise<StoreView> {
	try {
		return await prisma.store.create({
			data: {
				organizationId: familyId,
				name: data.name,
				// El canónico del duplicado: el mismo `normalizeItemName` de la
				// despensa y las categorías, para que «Mercadona» y «mercadona»
				// choquen igual que dos productos de despensa.
				normalizedName: normalizeItemName(data.name)
			},
			select: STORE_SELECT
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new StoreExistsError();
		}
		throw error;
	}
}

/**
 * Renombra un establecimiento de la familia; `false` si no hay establecimiento
 * con ese id EN ESA FAMILIA: la pertenencia va en el `where` del
 * `updateMany`, no en una comprobación previa aparte — sin ventana de carrera
 * entre el check y el write, y sin posibilidad de tocar un establecimiento
 * ajeno por un id rancio (mismo trato que `updateCategory`). Renombrar al MISMO
 * nombre no choca con el único: Postgres ignora el update que no cambia los
 * valores de la fila.
 *
 * Si el nombre nuevo normalizado lo ocupa OTRO establecimiento de la familia,
 * la base rechaza con P2002 y se traduce a `StoreExistsError`, como en el alta.
 */
export async function updateStore(familyId: string, id: string, data: StoreData): Promise<boolean> {
	try {
		const result = await prisma.store.updateMany({
			where: { id, organizationId: familyId },
			data: { name: data.name, normalizedName: normalizeItemName(data.name) }
		});
		return result.count > 0;
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new StoreExistsError();
		}
		throw error;
	}
}

/**
 * Borra un establecimiento de la familia; `false` si ya no estaba (doble
 * envío) o era de otra familia. Las compras del historial NO se borran: su FK
 * es `SetNull` (épica #177, tarea #179) — quedan sin establecimiento y el
 * historial conserva el nombre en `storeName`, el snapshot congelado al
 * finalizar la compra.
 */
export async function deleteStore(familyId: string, id: string): Promise<boolean> {
	const result = await prisma.store.deleteMany({
		where: { id, organizationId: familyId }
	});
	return result.count > 0;
}
