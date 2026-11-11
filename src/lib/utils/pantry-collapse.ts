import { SvelteSet } from 'svelte/reactivity';

// Clave única del colapsado de secciones de la despensa en localStorage (#209):
// el estado sobrevive a recargas y navegaciones. El valor es el array de
// claves colapsadas (`casa-<categoryId>` / `fuera-<categoryId>`); las que no
// están se leen expandidas — por defecto TODO se expande, la vista de hoy.
export const PANTRY_COLLAPSED_STORAGE_KEY = 'pantry-collapsed-v1';

/**
 * Lee las claves de sección colapsadas del storage. Sin `localStorage` (SSR y
 * primeros renders) o con JSON corrupto/con otra forma, conjunto vacío: se
 * pinta todo expandido en vez de reventar (patrón de `getTourState`).
 */
export function readPantryCollapsedKeys(): Set<string> {
	if (typeof localStorage === 'undefined') return new Set();
	const raw = localStorage.getItem(PANTRY_COLLAPSED_STORAGE_KEY);
	if (!raw) return new Set();
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((key): key is string => typeof key === 'string'));
	} catch {
		return new Set();
	}
}

/** Guarda las claves colapsadas. Sin `localStorage` (SSR), no-op. */
function writePantryCollapsedKeys(keys: Set<string>) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(PANTRY_COLLAPSED_STORAGE_KEY, JSON.stringify([...keys]));
}

/**
 * El estado de colapsado de las secciones de la despensa (#209): un
 * `SvelteSet` de claves que el render consulta por sección y que persiste en
 * localStorage en cada alternancia. `SvelteSet` y no `$state(new Set())` por
 * lo mismo que `SvelteMap` en la página: el deep-proxy de `$state` no cubre
 * colecciones y sus mutaciones no repintarían nada.
 */
export function createPantryCollapse() {
	const collapsed = new SvelteSet(readPantryCollapsedKeys());

	/** Alterna UNA sección y persiste el conjunto entero. */
	function toggle(key: string) {
		if (collapsed.has(key)) {
			collapsed.delete(key);
		} else {
			collapsed.add(key);
		}
		writePantryCollapsedKeys(collapsed);
	}

	return {
		collapsed,
		toggle,
		/** ¿Está colapsada esta sección? Reactivo: el render la consulta en cada repintado. */
		isCollapsed: (key: string) => collapsed.has(key)
	};
}
