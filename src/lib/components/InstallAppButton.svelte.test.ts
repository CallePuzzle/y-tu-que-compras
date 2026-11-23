import { afterEach, describe, expect, it, vi } from 'vitest';

// La locale activa la fija el mock del runtime (mismo truco que
// LanguageSwitcher): los mensajes del componente salen en español y las
// aserciones no dependen del idioma del runner.
const getLocale = vi.hoisted(() => vi.fn(() => 'es'));
vi.mock('#lib/paraglide/runtime.js', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getLocale
}));

import { render } from 'vitest-browser-svelte';
import InstallAppButton from './InstallAppButton.svelte';

const BUTTON_NAME = 'Instalar aplicación';
const IOS_TITLE = 'Instalar en tu iPhone o iPad';

/**
 * Evento `beforeinstallprompt` sintético, como el que el navegador despacha
 * cuando la app es instalable: `prompt` espía y `userChoice` ya resuelto.
 */
function syntheticPromptEvent() {
	return Object.assign(new Event('beforeinstallprompt'), {
		prompt: vi.fn().mockResolvedValue(undefined),
		userChoice: Promise.resolve({ outcome: 'accepted', platform: 'chromium' })
	});
}

/** Machaca una propiedad de sólo lectura del `navigator` (iOS, iPadOS). */
function stubNavigator(prop: 'userAgent' | 'maxTouchPoints', value: string | number) {
	Object.defineProperty(navigator, prop, { value, configurable: true });
}

afterEach(() => {
	vi.unstubAllGlobals();
	// Las propiedades machacadas son propias y configurables: al borrarlas
	// vuelven las del prototipo.
	Reflect.deleteProperty(navigator, 'userAgent');
	Reflect.deleteProperty(navigator, 'maxTouchPoints');
});

describe('InstallAppButton', () => {
	it('sin beforeinstallprompt ni iOS, el botón no se pinta (Firefox, etc.)', async () => {
		const { getByRole } = await render(InstallAppButton);
		expect(getByRole('button', { name: BUTTON_NAME }).elements().length).toBe(0);
	});

	it('ya instalada (standalone), sigue oculto aunque llegue el evento', async () => {
		vi.stubGlobal(
			'matchMedia',
			vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() })
		);
		const { getByRole } = await render(InstallAppButton);
		window.dispatchEvent(syntheticPromptEvent());
		await expect.poll(() => getByRole('button', { name: BUTTON_NAME }).elements().length).toBe(0);
	});

	it('llega beforeinstallprompt: aparece y el click llama a prompt() y lo retira', async () => {
		const { getByRole } = await render(InstallAppButton);

		const event = syntheticPromptEvent();
		window.dispatchEvent(event);
		await expect.element(getByRole('button', { name: BUTTON_NAME })).toBeVisible();

		await getByRole('button', { name: BUTTON_NAME }).click();
		expect(event.prompt).toHaveBeenCalledTimes(1);

		// El evento es de un solo uso: consumido el prompt, el botón se retira.
		await expect.poll(() => getByRole('button', { name: BUTTON_NAME }).elements().length).toBe(0);
	});

	it('en un iPhone aparece y el click abre el modal de instrucciones', async () => {
		stubNavigator(
			'userAgent',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
		);
		const { getByRole, getByText } = await render(InstallAppButton);

		await expect.element(getByRole('button', { name: BUTTON_NAME })).toBeVisible();
		await getByRole('button', { name: BUTTON_NAME }).click();

		await expect.element(getByRole('heading', { name: IOS_TITLE })).toBeVisible();
		await expect.element(getByText('En Safari, pulsa el botón Compartir.')).toBeVisible();
		await expect
			.element(getByText('Elige «Añadir a pantalla de inicio» y confirma.'))
			.toBeVisible();
	});

	it('un iPadOS (que se hace pasar por macOS) también es iOS: aparece', async () => {
		stubNavigator('userAgent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
		stubNavigator('maxTouchPoints', 5);
		const ipad = await render(InstallAppButton);
		await expect.element(ipad.getByRole('button', { name: BUTTON_NAME })).toBeVisible();

		// Y sin UA de Apple, ese mismo toque táctil no basta: es un desktop sin
		// evento, así que sigue oculto (el render anterior, desmontado, no da).
		await ipad.unmount();
		Reflect.deleteProperty(navigator, 'userAgent');
		const desktop = await render(InstallAppButton);
		await expect
			.poll(() => desktop.getByRole('button', { name: BUTTON_NAME }).elements().length)
			.toBe(0);
	});

	it('appinstalled lo esconde (la app ya está instalada)', async () => {
		const { getByRole } = await render(InstallAppButton);

		window.dispatchEvent(syntheticPromptEvent());
		await expect.element(getByRole('button', { name: BUTTON_NAME })).toBeVisible();

		window.dispatchEvent(new Event('appinstalled'));
		await expect.poll(() => getByRole('button', { name: BUTTON_NAME }).elements().length).toBe(0);
	});
});
