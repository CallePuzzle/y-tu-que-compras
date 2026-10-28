import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El cambio de idioma termina en `setLocale` (cookie de Paraglide + recarga):
// fuera de la app real no hay página que recargar, así que se simula. El resto
// de exports del runtime siguen siendo los reales: `messages.js` los necesita
// para resolver los textos del propio componente.
const setLocale = vi.hoisted(() => vi.fn());
const getLocale = vi.hoisted(() => vi.fn(() => 'es'));
vi.mock('$lib/paraglide/runtime.js', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getLocale,
	setLocale
}));

import { render } from 'vitest-browser-svelte';
import LanguageSwitcher from './LanguageSwitcher.svelte';

/** Primer elemento que resuelve el locator, sin lanzar si no hay ninguno. */
function firstOf(locator: { elements(): Element[] }): Element | null {
	return locator.elements()[0] ?? null;
}

beforeEach(() => {
	getLocale.mockClear().mockImplementation(() => 'es');
	setLocale.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('LanguageSwitcher', () => {
	it('pinta el desplegable con los dos idiomas y el activo marcado', async () => {
		const { getByRole } = await render(LanguageSwitcher);

		// El nombre accesible lo pone el `aria-label`; los items, los nombres
		// nativos de cada idioma (no se traducen).
		await getByRole('button', { name: 'Cambiar idioma' }).click();
		const espanol = firstOf(getByRole('button', { name: 'Español' }));
		const english = firstOf(getByRole('button', { name: 'English' }));
		expect(espanol).not.toBeNull();
		expect(english).not.toBeNull();

		// «es» es la locale activa del mock: su item lleva el check (svg) y
		// «English» el hueco alineador, para que los nombres queden en columna.
		expect(espanol?.querySelector('svg')).not.toBeNull();
		expect(english?.querySelector('svg')).toBeNull();
	});

	it('elegir un idioma delega en setLocale (cookie + recarga de Paraglide)', async () => {
		const { getByRole } = await render(LanguageSwitcher);

		await getByRole('button', { name: 'Cambiar idioma' }).click();
		await getByRole('button', { name: 'English' }).click();

		expect(setLocale).toHaveBeenCalledTimes(1);
		expect(setLocale).toHaveBeenCalledWith('en');
	});

	it('marca como activo el que devuelve getLocale', async () => {
		getLocale.mockImplementation(() => 'en');
		const { getByRole } = await render(LanguageSwitcher);

		// El mock del runtime también alimenta a `m.*`: con locale «en» el
		// nombre accesible del trigger sale en inglés, no en español.
		await getByRole('button', { name: 'Change language' }).click();
		expect(firstOf(getByRole('button', { name: 'English' }))?.querySelector('svg')).not.toBeNull();
		expect(firstOf(getByRole('button', { name: 'Español' }))?.querySelector('svg')).toBeNull();
	});
});
