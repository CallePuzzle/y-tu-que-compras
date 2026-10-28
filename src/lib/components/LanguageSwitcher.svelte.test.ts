import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import LanguageSwitcher from './LanguageSwitcher.svelte';
import { firstOf } from './test-utils.js';

beforeEach(() => {
	getLocale.mockClear().mockImplementation(() => 'es');
	setLocale.mockClear();
});

describe('LanguageSwitcher', () => {
	it('pinta el desplegable con los dos idiomas y el activo marcado', async () => {
		const { getByRole } = await render(LanguageSwitcher);

		// El nombre accesible lo pone el `aria-label`; los items, los nombres
		// nativos de cada idioma (no se traducen).
		await getByRole('button', { name: 'Cambiar idioma' }).click();
		const espanol = firstOf(getByRole('menuitemradio', { name: 'Español' }));
		const english = firstOf(getByRole('menuitemradio', { name: 'English' }));
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
		await getByRole('menuitemradio', { name: 'English' }).click();

		expect(setLocale).toHaveBeenCalledTimes(1);
		expect(setLocale).toHaveBeenCalledWith('en');
	});

	it('marca como activo el que devuelve getLocale', async () => {
		getLocale.mockImplementation(() => 'en');
		const { getByRole } = await render(LanguageSwitcher);

		// El mock del runtime también alimenta a `m.*`: con locale «en» el
		// nombre accesible del trigger sale en inglés, no en español.
		await getByRole('button', { name: 'Change language' }).click();
		expect(
			firstOf(getByRole('menuitemradio', { name: 'English' }))?.querySelector('svg')
		).not.toBeNull();
		expect(
			firstOf(getByRole('menuitemradio', { name: 'Español' }))?.querySelector('svg')
		).toBeNull();
	});

	it('con teclado: ↓ abre en el primer item, las flechas recorren y Escape cierra (#116)', async () => {
		const { getByRole } = await render(LanguageSwitcher);
		const trigger = getByRole('button', { name: 'Cambiar idioma' });
		const boton = firstOf(trigger) as HTMLButtonElement;

		boton.focus();
		await userEvent.keyboard('{ArrowDown}');
		await expect.element(getByRole('menu')).toBeVisible();
		expect(boton.getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement?.textContent).toContain('Español');

		await userEvent.keyboard('{ArrowDown}');
		expect(document.activeElement?.textContent).toContain('English');
		// Circular: tras el último vuelve al primero.
		await userEvent.keyboard('{ArrowDown}');
		expect(document.activeElement?.textContent).toContain('Español');

		await userEvent.keyboard('{Escape}');
		await expect.poll(() => getByRole('menu').elements().length).toBe(0);
		expect(boton.getAttribute('aria-expanded')).toBe('false');
		// El foco vuelve al disparador.
		expect(document.activeElement).toBe(boton);
	});

	it('pulsar fuera cierra el menú (#116)', async () => {
		const { getByRole } = await render(LanguageSwitcher);
		await getByRole('button', { name: 'Cambiar idioma' }).click();
		await expect.element(getByRole('menu')).toBeVisible();

		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		await expect.poll(() => getByRole('menu').elements().length).toBe(0);
	});
});
