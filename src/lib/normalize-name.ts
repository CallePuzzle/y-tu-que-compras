/**
 * El nombre canónico con el que la familia identifica un producto (#70):
 * minúsculas, sin acentos y con los espacios colapsados a uno solo (issue
 * #107: el comentario prometía «sin espacios sobrantes» pero no colapsaba los
 * internos, y «Leche  entera» y «Leche entera» creaban dos filas de despensa
 * que no se sumaban al re-añadir). Es lo que se guarda en
 * `PantryItem.normalizedName` para que «Leche Entera», «leche entera» y
 * «LECHE  entera» sumen sobre el mismo item de la despensa. Mismo trato que el
 * `slugify` de las familias (NFD + quitar diacríticos), pero conservando los
 * espacios: es un nombre, no un slug.
 *
 * Vive FUERA de `src/lib/server` porque lo usa también el cliente: el alta
 * rápida (#173) normaliza lo tecleado para buscarlo en el mapa de sugerencias
 * de categoría, que el servidor construyó con esta misma función.
 */
export function normalizeItemName(name: string): string {
	return name
		.trim()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/\s+/g, ' ');
}
