import { normalizeItemName } from '#lib/normalize-name.js';

/** La forma mínima que el filtro necesita de un artículo: su nombre y su categoría. */
interface SearchableItem {
	name: string;
	categoryName: string | null;
}

/**
 * ¿Casa el artículo con la consulta del buscador (#208)? Subcadena contra el
 * NOMBRE o la CATEGORÍA del artículo, normalizando ambos lados con
 * `normalizeItemName` (minúsculas, sin acentos y espacios colapsados): buscar
 * «telefono» encuentra «Teléfono fijo», y «lácteos» encuentra leche y yogur.
 * Consulta vacía o de solo espacios: todo casa (sin filtro).
 *
 * Vive junto al componente `ItemSearch.svelte` porque lo comparten la lista
 * y la despensa — las dos vistas con buscador (#208) — y como módulo puro es
 * directo de testear sin navegador.
 */
export function matchesItemSearch(item: SearchableItem, query: string): boolean {
	const normalizedQuery = normalizeItemName(query);
	if (!normalizedQuery) return true;
	return (
		normalizeItemName(item.name).includes(normalizedQuery) ||
		(item.categoryName !== null && normalizeItemName(item.categoryName).includes(normalizedQuery))
	);
}
