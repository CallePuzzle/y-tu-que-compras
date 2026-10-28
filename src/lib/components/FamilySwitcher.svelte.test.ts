import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// El cambio termina en `invalidateAll` ($app/navigation): fuera del runtime de
// SvelteKit no hace nada, así que se simula. Se conservan el resto de exports
// del módulo real (`afterNavigate`, …): el barrel de `@callepuzzle/svelte-ui`
// arrastra importadores que los necesitan.
const invalidateAll = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	invalidateAll
}));

import { render } from 'vitest-browser-svelte';
import FamilySwitcher from './FamilySwitcher.svelte';
import { firstOf } from './test-utils.js';

const families = [
	{ id: 'f1', name: 'Familia García' },
	{ id: 'f2', name: 'Los Pérez' }
];

const activa = { id: 'f1', name: 'Familia García' };

beforeEach(() => {
	invalidateAll.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('FamilySwitcher', () => {
	it('sin familias pinta el CTA a crear familia y ningún selector', async () => {
		const { getByRole, container } = await render(FamilySwitcher, { families: [] });

		const cta = firstOf(getByRole('link', { name: 'Crear familia' }));
		expect(cta).not.toBeNull();
		expect(cta?.getAttribute('href')).toBe('/families');
		expect(getByRole('button', { name: 'Cambiar de familia' }).elements()).toHaveLength(0);
		expect(container).toBeTruthy();
	});

	it('con familias pinta el desplegable con la activa marcada', async () => {
		const { getByRole } = await render(FamilySwitcher, { families, activeFamily: activa });

		// El nombre accesible lo pone el `aria-label`; el texto visible, la activa.
		expect(firstOf(getByRole('button', { name: 'Cambiar de familia' }))?.textContent).toContain(
			'Familia García'
		);

		// El menú abre por estado (#116), no por foco: click en el trigger y
		// los items aparecen, con la activa marcada y sin `disabled`.
		await getByRole('button', { name: 'Cambiar de familia' }).click();
		const items = [
			firstOf(getByRole('menuitemradio', { name: 'Familia García' })),
			firstOf(getByRole('menuitemradio', { name: 'Los Pérez' }))
		];
		expect(items.filter(Boolean).map((item) => (item as HTMLButtonElement).disabled)).toEqual([
			false,
			false
		]);
		expect(items.map((item) => item?.getAttribute('aria-checked'))).toEqual(['true', 'false']);
	});

	it('cambiar de familia hace el POST y luego invalida los datos', async () => {
		let captured: { url: unknown; init: RequestInit | undefined } | undefined;
		const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
			captured = { url, init };
			return new Response(null, { status: 204 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const { getByRole } = await render(FamilySwitcher, { families, activeFamily: activa });
		await getByRole('button', { name: 'Cambiar de familia' }).click();
		await getByRole('menuitemradio', { name: 'Los Pérez' }).click();

		await expect.poll(() => invalidateAll.mock.calls.length).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// Elegir cierra el menú (#116).
		await expect.poll(() => getByRole('menu').elements().length).toBe(0);
		// URL e init que recibió el fetch nativo simulado.
		expect(typeof captured).toBe('object');
		expect((captured?.url as URL | string).toString()).toBe('/families/active');
		expect(captured?.init?.method).toBe('POST');
		expect(captured?.init?.body).toBeInstanceOf(FormData);
		expect((captured?.init?.body as FormData | undefined)?.get('familyId')).toBe('f2');
	});

	it('un POST fallido no invalida y muestra el error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 403 }))
		);

		const { getByRole, getByText } = await render(FamilySwitcher, {
			families,
			activeFamily: activa
		});
		await getByRole('button', { name: 'Cambiar de familia' }).click();
		await getByRole('menuitemradio', { name: 'Los Pérez' }).click();

		// El aviso de error sólo se pinta cuando el fetch ya resolvió: si está,
		// el flujo terminó y `invalidateAll` no puede llegar tarde.
		await expect.poll(() => getByText('No se pudo cambiar de familia').elements().length).toBe(1);
		expect((invalidateAll as Mock).mock.calls.length).toBe(0);
		// Con error el menú sigue abierto: el aviso vive dentro.
		expect(getByRole('menu').elements()).toHaveLength(1);
	});
});
