import { normalizeItemName } from '#lib/normalize-name.js';
import prisma from '#lib/server/prisma.js';

// Sugerencia de categoría por nombre conocido (issue #173, épica #164): al
// escribir en el alta rápida un nombre que la familia ya conoce, el select de
// categoría se autocompleta con la categoría que esa familia le suele dar —
// SIEMPRE editable: es una sugerencia, nunca una imposición (el select sigue
// funcionando igual y lo manual manda).
//
// La resolución compara por nombre CANÓNICO (`normalizeItemName`), igual que
// la despensa identifica sus productos: «Leche Entera», «leche entera» y
// «LECHE  entera» son el mismo nombre a efectos de sugerir. Las fuentes son
// la despensa de la familia y los items de TODAS sus listas — lo comprado en
// otra lista también es «conocido».
//
// El resultado es un mapa nombre canónico -> id de categoría que el load
// entrega a la página: el cliente resuelve cada tecla SIN consultas nuevas.

/** El mapa de sugerencias: nombre canónico -> id de categoría de la familia. */
export type CategorySuggestions = Record<string, string>;

/** De dónde salió una fila candidata: la despensa manda sobre los items. */
export const SOURCE_PANTRY = 0;
export const SOURCE_ITEM = 1;

/** Una fila candidata a sugerir, tal y como la traen las consultas. */
export interface SuggestionRow {
	/** Nombre visible (el del item; la despensa además trae el canónico). */
	name: string;
	/** Canónico ya guardado (solo la despensa lo tiene: `normalizedName`). */
	normalizedName?: string;
	/** Categoría conocida del nombre; `null` = sin ella, no sugiere nada. */
	categoryId: string | null;
	/** Prioridad de la fuente: menor gana (la despensa es la memoria asentada). */
	source: number;
	/** Desempate dentro de la misma fuente: la opinión más RECENTE gana. */
	updatedAt: Date;
}

/**
 * La resolución pura de sugerencias (issue #173): de todas las filas
 * conocidas, queda UNA categoría por nombre canónico. Sin base de datos y sin
 * familia — lo que viaja son filas ya filtradas por familia —, así que todo
 * el contrato se testea unitariamente. Las reglas:
 *
 * 1. Solo sugieren nombres con categoría: las filas `categoryId: null` (o sin
 *    nombre útil una vez normalizado) no entran en el mapa.
 * 2. Fuente: la despensa sobre los items de listas (es la memoria asentada
 *    de la familia; los items son el estado en curso de cada compra).
 * 3. Recencia: a igual fuente, el `updatedAt` más nuevo (la última vez que
 *    la familia clasificó ese nombre manda sobre las anteriores).
 */
export function resolveCategorySuggestions(rows: SuggestionRow[]): CategorySuggestions {
	const mejores = new Map<string, { categoryId: string; source: number; updatedAt: Date }>();
	for (const row of rows) {
		if (!row.categoryId) {
			continue;
		}
		const key = row.normalizedName ?? normalizeItemName(row.name);
		if (!key) {
			continue;
		}
		const actual = mejores.get(key);
		if (
			!actual ||
			row.source < actual.source ||
			(row.source === actual.source && row.updatedAt > actual.updatedAt)
		) {
			mejores.set(key, {
				categoryId: row.categoryId,
				source: row.source,
				updatedAt: row.updatedAt
			});
		}
	}
	return Object.fromEntries([...mejores].map(([key, { categoryId }]) => [key, categoryId]));
}

/**
 * Las sugerencias de categoría de UNA familia (issue #173): su despensa y los
 * items de todas sus listas que tengan categoría. Los nombres de la despensa
 * llegan ya canónicos (`PantryItem.normalizedName`); los de los items se
 * normalizan aquí, que no guardan copia. Un producto de otra familia es como
 * si no existiera: la familia viaja en cada `where`, como en el resto de
 * módulos de servidor.
 */
export async function listCategorySuggestions(familyId: string): Promise<CategorySuggestions> {
	const [pantryRows, itemRows] = await Promise.all([
		prisma.pantryItem.findMany({
			where: { organizationId: familyId, categoryId: { not: null } },
			select: { name: true, normalizedName: true, categoryId: true, updatedAt: true }
		}),
		prisma.item.findMany({
			where: { list: { organizationId: familyId }, categoryId: { not: null } },
			select: { name: true, categoryId: true, updatedAt: true }
		})
	]);

	return resolveCategorySuggestions([
		...pantryRows.map(({ name, normalizedName, categoryId, updatedAt }) => ({
			name,
			normalizedName,
			categoryId,
			source: SOURCE_PANTRY,
			updatedAt
		})),
		...itemRows.map(({ name, categoryId, updatedAt }) => ({
			name,
			categoryId,
			source: SOURCE_ITEM,
			updatedAt
		}))
	]);
}
