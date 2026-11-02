import { describe, expect, it, vi } from 'vitest';

// La locale activa la fija el mock del runtime (mismo truco que
// LanguageSwitcher): los mensajes del componente salen en español y las
// aserciones no dependen del idioma del runner.
const getLocale = vi.hoisted(() => vi.fn(() => 'es'));
vi.mock('#lib/paraglide/runtime.js', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getLocale
}));

import { render } from 'vitest-browser-svelte';
import Home from './Home.svelte';
import { firstOf } from './test-utils.js';

describe('Home', () => {
	it('saluda por su nombre y expone los accesos a listas e historial (#161)', async () => {
		const { getByRole } = await render(Home, { user: { name: 'Ana', email: 'ana@example.com' } });

		await expect.element(getByRole('heading', { level: 1, name: 'Hola, Ana' })).toBeVisible();

		const listas = firstOf(getByRole('link', { name: 'Listas' }));
		expect(listas?.getAttribute('href')).toBe('/lists');
		// El acceso a listas lleva el ancla del paso 1 del tour (#142).
		expect(listas?.getAttribute('id')).toBe('tour-home-cta');

		expect(firstOf(getByRole('link', { name: 'Historial' }))?.getAttribute('href')).toBe(
			'/history'
		);
	});

	it('sin nombre saluda con el email: el alta por OTP crea usuarios anónimos', async () => {
		const { getByRole } = await render(Home, { user: { name: '', email: 'ana@example.com' } });

		await expect
			.element(getByRole('heading', { level: 1, name: 'Hola, ana@example.com' }))
			.toBeVisible();
	});

	it('el home mínimo no muestra más accesos: categorías y establecimientos llegan con sus épicas', async () => {
		const { getByRole } = await render(Home, { user: { name: 'Ana', email: 'ana@example.com' } });

		// Sólo listas e historial; categorías y establecimientos (#164, #177) se
		// añadirán con sus épicas (#161).
		expect(getByRole('link').elements()).toHaveLength(2);
	});
});
