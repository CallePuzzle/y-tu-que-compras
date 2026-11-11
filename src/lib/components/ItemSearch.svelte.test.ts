import { describe, expect, it, vi } from 'vitest';

// La locale activa la fija el mock del runtime (mismo truco que Home): los
// mensajes del componente salen en español y las aserciones no dependen del
// idioma del runner.
const getLocale = vi.hoisted(() => vi.fn(() => 'es'));
vi.mock('#lib/paraglide/runtime.js', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getLocale
}));

import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ItemSearch from './ItemSearch.svelte';
import { firstOf } from './test-utils.js';

describe('ItemSearch (#208)', () => {
	it('pinta el campo con su etiqueta, su placeholder y la lupa; sin consulta no hay botón de limpiar', async () => {
		const { getByRole } = await render(ItemSearch);

		const input = getByRole('textbox', { name: 'Buscar artículos' });
		await expect.element(input).toBeVisible();
		expect(firstOf(input)?.getAttribute('placeholder')).toBe('Buscar por nombre o categoría…');
		// La lupa decora el campo (svg con aria-hidden)…
		expect(firstOf(input)?.parentElement?.querySelector('svg')).not.toBeNull();
		// …y sin texto que limpiar, el X no está.
		expect(getByRole('button', { name: 'Limpiar la búsqueda' }).elements()).toHaveLength(0);
	});

	it('una consulta inicial se refleja en el campo y muestra el botón de limpiar', async () => {
		const { getByRole } = await render(ItemSearch, { query: 'leche' });

		const input = getByRole('textbox', { name: 'Buscar artículos' });
		await expect.element(input).toHaveValue('leche');
		await expect.element(getByRole('button', { name: 'Limpiar la búsqueda' })).toBeVisible();
	});

	it('escribir muestra el botón de limpiar y pulsarlo vacía el campo', async () => {
		const { getByRole } = await render(ItemSearch);

		const input = getByRole('textbox', { name: 'Buscar artículos' });
		await userEvent.type(input, 'teléfono');

		// Con consulta hay X que pulsar…
		const clear = getByRole('button', { name: 'Limpiar la búsqueda' });
		await expect.element(clear).toBeVisible();

		// …y al pulsarlo el campo queda vacío y el X desaparece.
		await clear.click();
		await expect.element(input).toHaveValue('');
		await expect
			.poll(() => getByRole('button', { name: 'Limpiar la búsqueda' }).elements().length)
			.toBe(0);
	});
});
