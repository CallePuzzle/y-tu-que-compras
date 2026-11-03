import { Prisma } from '#lib/generated/prisma/client.js';
import type { CategoryData } from '#lib/schemas/category.js';
import prisma from '#lib/server/prisma.js';
import { normalizeItemName } from '#lib/server/purchases.js';

// CRUD de categorías de la familia (issue #169, épica #164). La familia viaja
// SIEMPRE en los argumentos: es la activa que `requireActiveFamily` dejó
// verificada en el load/acción, y todas las consultas la llevan en el `where` —
// una categoría de otra familia es como si no existiera (mismo criterio que
// `lists.ts`). Son escritura para cualquier miembro (issue #111): sin checks de
// rol. El orden también lo gestiona el servidor: `position` lo asigna el alta
// al final del orden de la familia y `reorderCategories` lo reescribe — nadie
// manda posiciones sueltas desde el cliente.

/** Una categoría tal y como la vista de categorías la muestra. */
export interface CategoryView {
	id: string;
	name: string;
	/** Posición en el orden de la familia; la fija el servidor, nunca el cliente. */
	position: number;
}

/** Otra categoría de la familia ya usa ese nombre (tras normalizar). */
export class CategoryExistsError extends Error {
	constructor() {
		super('Category name already exists in this family');
		this.name = 'CategoryExistsError';
	}
}

const CATEGORY_SELECT = { id: true, name: true, position: true } as const;

/** ¿Es el P2002 de Postgres? La tabla `category` solo tiene un índice único — (familia, nombre normalizado) —, así que el código basta. */
function isUniqueViolation(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Las categorías de la familia, en su orden (posición, y por creación para desempatar). */
export async function listCategories(familyId: string): Promise<CategoryView[]> {
	return prisma.category.findMany({
		where: { organizationId: familyId },
		select: CATEGORY_SELECT,
		orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
	});
}

/**
 * Crea una categoría en la familia con el nombre ya validado por
 * `categorySchema`. La posición la pone el SERVIDOR (al final del orden de la
 * familia), como el `order` de los items.
 *
 * El duplicado se detecta en la base: el índice único (familia, nombre
 * normalizado) rechaza «Lácteos» si ya hay «lacteos», « LÁCTEOS » o cualquier
 * variante que `normalizeItemName` haga canónicamente igual — y es a prueba de
 * carrera, sin ventana entre un check previo y el write. El P2002 se traduce a
 * `CategoryExistsError` para que la acción lo convierta en el mensaje de la UI,
 * sin filtrar el error crudo de Prisma.
 */
export async function createCategory(familyId: string, data: CategoryData): Promise<CategoryView> {
	// La posición nueva es la del último + 1 (-1 si la familia aún no tiene
	// ninguna). No exige transacción: una colisión de posiciones entre dos
	// altas concurrentes es inofensiva (no hay único sobre `position`) y el
	// orden sigue siendo determinista.
	const { _max } = await prisma.category.aggregate({
		where: { organizationId: familyId },
		_max: { position: true }
	});

	try {
		return await prisma.category.create({
			data: {
				organizationId: familyId,
				name: data.name,
				// El canónico del duplicado: el mismo `normalizeItemName` de la
				// despensa (épica #164), para que «Leche Entera» y «leche entera»
				// choquen igual que dos productos de despensa.
				normalizedName: normalizeItemName(data.name),
				position: (_max.position ?? -1) + 1
			},
			select: CATEGORY_SELECT
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new CategoryExistsError();
		}
		throw error;
	}
}

/**
 * Renombra una categoría de la familia; `false` si no hay categoría con ese id
 * EN ESA FAMILIA: la pertenencia va en el `where` del `updateMany`, no en una
 * comprobación previa aparte — sin ventana de carrera entre el check y el
 * write, y sin posibilidad de tocar una categoría ajena por un id rancio
 * (mismo trato que `updateList`). Renombrar al MISMO nombre no choca con el
 * único: Postgres ignora el update que no cambia los valores de la fila.
 *
 * Si el nombre nuevo normalizado lo ocupa OTRA categoría de la familia, la
 * base rechaza con P2002 y se traduce a `CategoryExistsError`, como en el alta.
 */
export async function updateCategory(
	familyId: string,
	id: string,
	data: CategoryData
): Promise<boolean> {
	try {
		const result = await prisma.category.updateMany({
			where: { id, organizationId: familyId },
			data: { name: data.name, normalizedName: normalizeItemName(data.name) }
		});
		return result.count > 0;
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new CategoryExistsError();
		}
		throw error;
	}
}

/**
 * Borra una categoría de la familia; `false` si ya no estaba (doble envío) o
 * era de otra familia. Los items, productos de despensa y snapshots del
 * historial NO se borran: sus FKs son `SetNull` (épica #164) — quedan sin
 * categoría y el historial conserva el nombre en `categoryName`.
 */
export async function deleteCategory(familyId: string, id: string): Promise<boolean> {
	const result = await prisma.category.deleteMany({
		where: { id, organizationId: familyId }
	});
	return result.count > 0;
}

/**
 * Reordena categorías de la familia: asigna `position = índice` siguiendo el
 * orden del array, dentro de una transacción para que nadie vea un estado a
 * medias mientras se reescriben las posiciones.
 *
 * Solo cuentan los ids DE LA FAMILIA: un id ajeno o ya borrado se ignora (es
 * «como si no existiera», como en el resto del módulo). Los duplicados del
 * array se colapsan: repetir un id no le daría dos posiciones. Las categorías
 * que no vienen en el array conservan su posición previa — la UI manda la
 * lista completa que acaba de leer, así que en la práctica se reescribe todo.
 */
export async function reorderCategories(familyId: string, orderedIds: string[]): Promise<void> {
	const unicos = [...new Set(orderedIds)];
	await prisma.$transaction(async (tx) => {
		const propias = await tx.category.findMany({
			where: { id: { in: unicos }, organizationId: familyId },
			select: { id: true }
		});
		const propiasIds = new Set(propias.map((categoria) => categoria.id));

		const ordenPropio = unicos.filter((id) => propiasIds.has(id));
		for (const [position, id] of ordenPropio.entries()) {
			await tx.category.updateMany({
				where: { id, organizationId: familyId },
				data: { position }
			});
		}
	});
}
