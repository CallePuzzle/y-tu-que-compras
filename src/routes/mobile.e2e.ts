import { expect, test, type Page } from '@playwright/test';
import { seedSession, waitForHydration } from '../../e2e/helpers/auth';
import { createFamily, createItem, createList, createUser, resetDb } from '../../e2e/helpers/seed';

// Test e2e MÓVIL transversal (issue #79). No vive junto a UNA ruta porque las
// recorre todas: comprueba que la navegación del layout (Dock en móvil,
// cajón lateral, selector de idioma) y las vistas principales son usables en
// una pantalla táctil. Sólo lo corre el proyecto `mobile` de
// playwright.config.ts, con el dispositivo `Pixel 7`.
//
// OJO al idioma: Pixel 7 emula `locale: en-US`, así que la primera visita
// llega con `Accept-Language: en-US` y la app arranca en INGLÉS (detección
// `preferredLanguage` de la #78, sin cookie previa). El spec va en inglés y
// es, de paso, la prueba e2e de esa detección; el cambio de idioma y su
// persistencia por cookie se cubren al final.

test.beforeEach(async () => {
	await resetDb();
});

/** Nada desborda el ancho del viewport: sin scroll horizontal en ninguna vista. */
async function expectSinDesborde(page: Page): Promise<void> {
	const ancho = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth
	}));
	expect(
		ancho.scroll,
		`scrollWidth (${ancho.scroll}px) supera el viewport (${ancho.client}px)`
	).toBeLessThanOrEqual(ancho.client);
}

test('el dock navega las rutas principales y ninguna vista desborda el ancho', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const lista = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: lista.id, name: 'Leche', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/');
	await waitForHydration(page);

	// Navegación por dock (móvil); la de escritorio queda oculta. Los nombres
	// accesibles los ponen los `aria-label` del layout (`ui_bottom_nav`,
	// `ui_main_nav`), aquí en inglés por la locale del dispositivo.
	const dock = page.getByRole('navigation', { name: 'Bottom navigation' });
	await expect(dock).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();

	// Las cinco rutas con sesión: se llega por el dock, la cabecera pinta la
	// vista y nada desborda el ancho del teléfono.
	const rutas = [
		{ enlace: 'Home', cabecera: 'What are you buying?' },
		{ enlace: 'Lists', cabecera: 'Your lists' },
		{ enlace: 'Pantry', cabecera: 'Your pantry' },
		{ enlace: 'History', cabecera: 'Purchase history' },
		{ enlace: 'Families', cabecera: 'Your families' }
	];
	for (const ruta of rutas) {
		await dock.getByRole('link', { name: ruta.enlace }).click();
		await expect(page.getByRole('heading', { name: ruta.cabecera })).toBeVisible();
		await expectSinDesborde(page);
	}
});

test('el cajón lateral abre con la hamburguesa y cierra tocando fuera', async ({ page }) => {
	const user = await createUser();
	await createFamily({ name: 'Familia Única', owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	// El disparador es el `menuToggleFor` del Header (label del checkbox del
	// Drawer): un target grande, pensado para el pulgar. El checkbox que
	// gobierna el CSS está oculto (0x0), así que se toca su label; el estado
	// real se lee del `checked`, sin depender del idioma del `aria-label`.
	const panel = page.locator('.drawer-side');
	const toggle = page.locator('.navbar label[aria-label]');
	await expect(panel).toBeHidden();
	await toggle.click();
	await expect(page.locator('input.drawer-toggle')).toBeChecked();
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('navigation', { name: 'Side navigation' })).toBeVisible();

	// El overlay cierra: una mano, sin buscar una X. Su centro queda debajo
	// del panel (el grid lo estira detrás del w-80), así que el toque va a la
	// parte descubierta, a la derecha del panel.
	await page.locator('.drawer-overlay').click({ position: { x: 380, y: 400 } });
	await expect(page.locator('input.drawer-toggle')).not.toBeChecked();
	await expect(panel).toBeHidden();
});

test('los modales caben en la pantalla: crear lista desde el móvil', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	await page.getByRole('button', { name: 'New list' }).first().click();
	const dialogo = page.locator('dialog[open]');
	await expect(dialogo).toBeVisible();

	// El modal-box (max-w-md con los márgenes de daisyUI) entra entero en el
	// viewport del teléfono: es el «adaptado a pantalla pequeña» de la checklist.
	const caja = await dialogo.locator('.modal-box').boundingBox();
	expect(caja).not.toBeNull();
	expect(caja!.x).toBeGreaterThanOrEqual(0);
	expect(caja!.x + caja!.width).toBeLessThanOrEqual(
		(await page.evaluate(() => document.documentElement.clientWidth)) + 1
	);

	// Y el flujo completo funciona con el teclado táctil: crear y ver el toast.
	await dialogo.locator('input[name="name"]').fill('Frutería');
	await dialogo.getByRole('button', { name: 'New list' }).click();
	await expect(page.getByRole('status')).toContainText('List created: it now shows in the view.');
});

test('el idioma inicial sale de Accept-Language, el selector lo cambia y persiste', async ({
	page
}) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	// Primera visita sin cookie: el `Accept-Language: en-US` del dispositivo
	// elige inglés (estrategia `preferredLanguage`, issue #78).
	await page.goto('/');
	await waitForHydration(page);
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByRole('heading', { name: 'What are you buying?' })).toBeVisible();

	// Cambio a español: setLocale escribe la cookie de Paraglide y recarga.
	await page.getByRole('button', { name: 'Change language' }).click();
	await page.getByRole('menuitemradio', { name: 'Español' }).click();

	// Tras la recarga, todo el chrome sale en español — incluido el dock.
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');
	await expect(page.getByRole('heading', { name: '¿Y tú qué compras?' })).toBeVisible();
	const dock = page.getByRole('navigation', { name: 'Navegación inferior' });
	await expect(dock).toBeVisible();
	await expectSinDesborde(page);

	// La cookie persiste: otra recarga sigue en español.
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');
	await expect(page.getByRole('heading', { name: '¿Y tú qué compras?' })).toBeVisible();
});

test('el menú de usuario abre con un toque y cierra sesión', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	// Issue #116: el menú de usuario lo pinta `NavBarEnd` de svelte-ui, que
	// abría por `:focus-within`; en WebKit (proyecto `webkit`, un iPhone) un
	// toque no da foco al botón y el menú no llegaba a abrir. Desde svelte-ui
	// 1.1.0 abre por estado.
	const disparador = page.getByRole('button', { name: 'User menu' });
	await disparador.click();
	await expect(disparador).toHaveAttribute('aria-expanded', 'true');
	const menu = page.getByRole('menu', { name: 'User menu' });
	await expect(menu).toBeVisible();

	// Tocar fuera lo cierra.
	await page.getByRole('heading', { name: 'Your lists' }).click();
	await expect(menu).toBeHidden();

	// Y la entrada de cerrar sesión funciona desde el menú: el guard manda a /login.
	await disparador.click();
	await page.getByRole('menuitem', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login/);
});
