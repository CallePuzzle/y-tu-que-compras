// Utilidades compartidas por los tests de componentes (proyecto `client`).

/** Primer elemento que resuelve el locator, sin lanzar si no hay ninguno. */
export function firstOf(locator: { elements(): Element[] }): Element | null {
	return locator.elements()[0] ?? null;
}
