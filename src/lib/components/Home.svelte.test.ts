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
	it('saluda por su nombre y expone los seis accesos del menú (#161)', async () => {
		const { getByRole } = await render(Home, { user: { name: 'Ana', email: 'ana@example.com' } });

		await expect.element(getByRole('heading', { level: 1, name: 'Hola, Ana' })).toBeVisible();

		// Cada acceso: su href y, para el de listas, el ancla del tour (#142).
		// El nombre accesible incluye la descripción (`home_*_text`), así que
		// los localizadores van anclados al principio del nombre.
		const hrefs = ['/lists', '/pantry', '/history', '/categories', '/stores', '/families'];
		const names = ['Listas', 'Despensa', 'Historial', 'Categorías', 'Establecimientos', 'Familias'];
		for (const [i, name] of names.entries()) {
			const link = firstOf(getByRole('link', { name: new RegExp(`^${name}`) }));
			expect(link?.getAttribute('href'), name).toBe(hrefs[i]);
		}
		// El acceso a listas lleva el ancla del paso 1 del tour (#142).
		const lists = firstOf(getByRole('link', { name: /^Listas/ }));
		expect(lists?.getAttribute('id')).toBe('tour-home-cta');
	});

	it('sin nombre saluda con el email: el alta por OTP crea usuarios anónimos', async () => {
		const { getByRole } = await render(Home, { user: { name: '', email: 'ana@example.com' } });

		await expect
			.element(getByRole('heading', { level: 1, name: 'Hola, ana@example.com' }))
			.toBeVisible();
	});

	it('los seis accesos del menú, cada uno con su descripción', async () => {
		const { getByRole } = await render(Home, { user: { name: 'Ana', email: 'ana@example.com' } });

		// El home ya no es el mínimo de #161: listas, despensa, historial,
		// categorías (#164), establecimientos (#177) y familias, todos con la
		// línea descriptiva (`home_*_text`) bajo la etiqueta.
		expect(getByRole('link').elements()).toHaveLength(6);
		for (const name of [
			'Listas',
			'Despensa',
			'Historial',
			'Categorías',
			'Establecimientos',
			'Familias'
		]) {
			const link = firstOf(getByRole('link', { name: new RegExp(`^${name}`) }));
			expect(link?.textContent, name).toContain(name);
		}
		// El de despensa muestra su descripción (`home_pantry_text`).
		expect(firstOf(getByRole('link', { name: /^Despensa/ }))?.textContent).toContain(
			'lo comprado entra solo'
		);
	});
});
