import { normalizeItemName } from '#lib/normalize-name.js';
import prisma from '#lib/server/prisma.js';
import type { Unit } from '#lib/schemas/item.js';

// Sugerencias por nombre conocido (issue #173, épica #164; ampliadas en la
// épica #286): al escribir un nombre de producto que la familia ya conoce, el
// formulario lo autocompleta y pre-rellena lo que la familia le suele dar
// (unidad, categoría, enlace a despensa) — SIEMPRE editable: es una
// sugerencia, nunca una imposición (lo manual manda).
//
// La resolución compara por nombre CANÓNICO (`normalizeItemName`), igual que
// la despensa identifica sus productos: «Leche Entera», «leche entera» y
// «LECHE  entera» son el mismo nombre a efectos de sugerir. Las fuentes son
// la despensa de la familia, los items de TODAS sus listas y los ingredientes
// de sus recetas.
//
// La categoría sigue la regla de #173 (`resolveCategorySuggestions`, pura) y
// la consume la resolución de nombres (`resolveProductNameSuggestions`); el
// load entrega a la página la lista ya resuelta
// (`listProductNameSuggestions`) y el cliente resuelve cada tecla SIN
// consultas nuevas.

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
export function resolveCategorySuggestions(rows: SuggestionRow[]): Record<string, string> {
	const best = new Map<string, { categoryId: string; source: number; updatedAt: Date }>();
	for (const row of rows) {
		if (!row.categoryId) {
			continue;
		}
		const key = row.normalizedName ?? normalizeItemName(row.name);
		if (!key) {
			continue;
		}
		const current = best.get(key);
		if (
			!current ||
			row.source < current.source ||
			(row.source === current.source && row.updatedAt > current.updatedAt)
		) {
			best.set(key, {
				categoryId: row.categoryId,
				source: row.source,
				updatedAt: row.updatedAt
			});
		}
	}
	return Object.fromEntries([...best].map(([key, { categoryId }]) => [key, categoryId]));
}

// Sugerencias de NOMBRE de producto (issue #282, épica #286): el autocompletado
// con `<datalist>` de todos los inputs de nombre (alta rápida, editar item,
// ingredientes de recetas y menús) sugiere lo que la familia ya ha escrito
// alguna vez, colapsado por nombre canónico para que «Patatas» y «patatas» sean
// UNA sola opción y no se sigan multiplicando las variantes. Mismo contrato que
// la resolución de categoría de arriba: fuentes ya filtradas por familia,
// resolución pura testeable sin base de datos y una lista que el load entrega a
// la página para que el cliente no consulte nada por tecla.

/** Tercera fuente, solo para nombres: los ingredientes de las recetas. */
export const SOURCE_RECIPE = 2;

/** Una fila candidata a sugerir nombre: la de categoría más su unidad y enlace. */
export interface ProductNameRow extends SuggestionRow {
	/** La unidad con la que la familia escribió ese producto en esa fuente. */
	unit: Unit;
	/** Id del producto de despensa; solo lo traen las filas de despensa. */
	pantryItemId?: string | null;
}

/** Una sugerencia de nombre, lista para un `<option>` y para pre-rellenar. */
export interface ProductNameSuggestion {
	/** Nombre visible tal y como lo escribió la fila ganadora. */
	name: string;
	/** Unidad sugerida: la de la fila ganadora. */
	unit: Unit;
	/**
	 * Categoría sugerida: la misma regla que `resolveCategorySuggestions` sobre
	 * las filas de ese canónico (solo cuentan las que tienen categoría), así
	 * que un nombre cuya fila ganadora no tiene categoría aún puede sugerir la
	 * de otra fuente. `null` = ninguna fila del canónico tiene categoría.
	 */
	categoryId: string | null;
	/** Producto de despensa a enlazar (recetas/menús); `null` si no ganó la despensa. */
	pantryItemId: string | null;
}

/**
 * La resolución pura de sugerencias de nombre (issue #282): de todas las filas
 * conocidas queda UNA sugerencia por nombre canónico (`normalizeItemName`; la
 * despensa trae el suyo ya guardado). Reglas, las mismas que en #173:
 *
 * 1. Nombres que el canónico deja vacíos no sugieren nada.
 * 2. Fuente: despensa (0) sobre items de listas (1) sobre ingredientes de
 *    recetas (2). La fila ganadora da nombre visible, unidad y `pantryItemId`
 *    (este último solo si ganó la despensa).
 * 3. Recencia: a igual fuente, el `updatedAt` más nuevo. Así un mismo
 *    canónico con varias unidades en despensa (el único de PantryItem es
 *    familia + canónico + unidad) colapsa en la fila más reciente.
 *
 * La categoría se resuelve aparte con `resolveCategorySuggestions` sobre las
 * mismas filas, para que coincida con lo que sugeriría el mapa de categorías.
 * El resultado va ordenado por nombre visible (orden estable del datalist).
 */
export function resolveProductNameSuggestions(rows: ProductNameRow[]): ProductNameSuggestion[] {
	const best = new Map<string, ProductNameRow>();
	for (const row of rows) {
		const key = row.normalizedName ?? normalizeItemName(row.name);
		if (!key) {
			continue;
		}
		const current = best.get(key);
		if (
			!current ||
			row.source < current.source ||
			(row.source === current.source && row.updatedAt > current.updatedAt)
		) {
			best.set(key, row);
		}
	}
	const categories = resolveCategorySuggestions(rows);
	return [...best]
		.map(([key, row]) => ({
			name: row.name.trim(),
			unit: row.unit,
			categoryId: categories[key] ?? null,
			pantryItemId: row.source === SOURCE_PANTRY ? (row.pantryItemId ?? null) : null
		}))
		.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Las sugerencias de nombre de UNA familia (issue #282): su despensa, los
 * items de todas sus listas y los ingredientes de todas sus recetas. La
 * familia viaja en cada `where`; los ingredientes no tienen `updatedAt` y
 * desempatan con el de su receta (la última vez que se tocó la receta).
 */
export async function listProductNameSuggestions(
	familyId: string
): Promise<ProductNameSuggestion[]> {
	const [pantryRows, itemRows, ingredientRows] = await Promise.all([
		prisma.pantryItem.findMany({
			where: { organizationId: familyId },
			select: {
				id: true,
				name: true,
				normalizedName: true,
				unit: true,
				categoryId: true,
				updatedAt: true
			}
		}),
		prisma.item.findMany({
			where: { list: { organizationId: familyId } },
			select: { name: true, unit: true, categoryId: true, updatedAt: true }
		}),
		prisma.recipeIngredient.findMany({
			where: { recipe: { organizationId: familyId } },
			select: { name: true, unit: true, categoryId: true, recipe: { select: { updatedAt: true } } }
		})
	]);

	return resolveProductNameSuggestions([
		...pantryRows.map(({ id, name, normalizedName, unit, categoryId, updatedAt }) => ({
			name,
			normalizedName,
			unit,
			categoryId,
			pantryItemId: id,
			source: SOURCE_PANTRY,
			updatedAt
		})),
		...itemRows.map(({ name, unit, categoryId, updatedAt }) => ({
			name,
			unit,
			categoryId,
			source: SOURCE_ITEM,
			updatedAt
		})),
		...ingredientRows.map(({ name, unit, categoryId, recipe }) => ({
			name,
			unit,
			categoryId,
			source: SOURCE_RECIPE,
			updatedAt: recipe.updatedAt
		}))
	]);
}
