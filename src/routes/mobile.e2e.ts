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
async function expectNoOverflow(page: Page): Promise<void> {
	const width = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth
	}));
	expect(
		width.scroll,
		`scrollWidth (${width.scroll}px) supera el viewport (${width.client}px)`
	).toBeLessThanOrEqual(width.client);
}

test('el dock navega las rutas principales y ninguna vista desborda el ancho', async ({ page }) => {
	// Nombre fijo: la cabecera del home es el saludo (#161) y la aserción la
	// necesita determinista.
	const user = await createUser({ name: 'Navegante' });
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: list.id, name: 'Leche', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/');
	await waitForHydration(page);

	// Navegación por dock (móvil); la de escritorio queda oculta. Los nombres
	// accesibles los ponen los `aria-label` del layout (`ui_bottom_nav`,
	// `ui_main_nav`), aquí en inglés por la locale del dispositivo.
	const dock = page.getByRole('navigation', { name: 'Bottom navigation' });
	await expect(dock).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();

	// Con sesión el dock se queda con cuatro rutas (#162): se llega por él, la
	// cabecera pinta la vista y nada desborda el ancho del teléfono. La del
	// home es el saludo (#161), en inglés por la locale del dispositivo.
	const routes = [
		{ link: 'Home', header: 'Hi, Navegante' },
		{ link: 'Lists', header: 'Your lists' },
		{ link: 'Pantry', header: 'Your pantry' },
		{ link: 'Families', header: 'Your families' }
	];
	for (const route of routes) {
		await dock.getByRole('link', { name: route.link }).click();
		await expect(page.getByRole('heading', { name: route.header })).toBeVisible();
		await expectNoOverflow(page);
	}

	// El historial sale del dock (#162): ningún enlace en la barra inferior;
	// se alcanza por el cajón lateral, que lo sigue mostrando (igual que el
	// menú de escritorio, que no filtra por `showInMobile`).
	await expect(dock.getByRole('link', { name: 'History' })).toHaveCount(0);
	await page.locator('.navbar label[for]').click();
	const drawer = page.locator('.drawer-side');
	await expect(drawer).toBeVisible();
	await drawer.getByRole('link', { name: 'History' }).click();
	await expect(page.getByRole('heading', { name: 'Purchase history' })).toBeVisible();
	await expectNoOverflow(page);
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
	// real se lee del `checked`, sin depender del idioma del texto. El nombre
	// accesible ya no va en `aria-label` (prohibido sobre <label>, lo quitó
	// svelte-ui 1.1.2 por un `sr-only` interno): se localiza por su `for`.
	const panel = page.locator('.drawer-side');
	const toggle = page.locator('.navbar label[for]');
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

	// Issue #145 (svelte-ui 1.2.0): el cajón no sobrevive a la navegación. El
	// layout no se remonta al navegar y el checkbox llegaba MARCADO a la página
	// destino: el panel salía abierto tras cualquier enlace del propio cajón.
	// La navegación cierra y el estado del checkbox lo confirma.
	await toggle.click();
	await expect(page.locator('input.drawer-toggle')).toBeChecked();
	await panel.getByRole('link', { name: 'Home' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('input.drawer-toggle')).not.toBeChecked();
	await expect(panel).toBeHidden();
});

test('el tour esconde el cajón lateral mientras su diálogo está en pantalla (#144)', async ({
	page
}) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	// `seedSession` siembra el tour como visto para no bloquear al resto de
	// specs; aquí ES el test de su arranque, así que lo re-armamos quitando la
	// clave (mismo truco que page.svelte.e2e.ts).
	await page.addInitScript(() => localStorage.removeItem('onboarding-tour-v1'));

	// Carrera determinista: se RETIENE la entrega del chunk del cliente del
	// tour (el import dinámico de `@sjmc11/tourguidejs`; vite dev lo sirve con
	// su nombre en la URL de `.vite/deps`) hasta que el cajón está ABIERTO en
	// la portada. Así el diálogo llega con el panel ya delante —el caso que el
	// `bind:open` del layout debe resolver (#144)— sin depender de qué gana
	// la carrera hidratación vs. import dinámico. La respuesta se descarga YA
	// (fetch) y se entrega luego (fulfill): mientras se retiene, el import del
	// tour queda en pausa sin mantener la red ocupada.
	let requestedChunk = false;
	// El executor corre síncrono: al salir de `new Promise` el resolver está
	// asignado (el `!` se lo dice al compilador, que no sigue closures).
	let releaseChunk!: () => void;
	const heldChunk = new Promise<void>((resolve) => {
		releaseChunk = resolve;
	});
	await page.route('**/*tourguide*', async (route) => {
		const response = await route.fetch();
		requestedChunk = true;
		await heldChunk;
		await route.fulfill({ response: response });
	});

	await page.goto('/', { waitUntil: 'domcontentloaded' });

	// Hidratación confirmada POR la petición retenida: el efecto de la portada
	// ya pidió el chunk del tour —sin hydration no hay `$effect`— y el chunk
	// sigue retenido, así que el diálogo no ha podido aparecer.
	await expect.poll(() => requestedChunk, { timeout: 10_000 }).toBe(true);

	// El cajón abre sin prisa: nada lo tapa porque el chunk sigue retenido
	// (el toggle es el label del checkbox del Drawer; ver el test de la
	// hamburguesa).
	const toggle = page.locator('.navbar label[for]');
	await toggle.click();
	await expect(page.locator('input.drawer-toggle')).toBeChecked();

	// Liberado el chunk, el diálogo aparece CON el panel abierto: el layout
	// lo cierra por estado (`bind:open`) en cuanto el tour se ve, y el
	// checkbox —con su CSS— esconde el panel. Sin el cierre por estado, el
	// panel se quedaría encima del tour.
	releaseChunk();
	const tour = page.locator('.tg-dialog');
	await expect(tour).toBeVisible();
	await expect(page.locator('input.drawer-toggle')).not.toBeChecked();
	await expect(page.locator('.drawer-side')).toBeHidden();
});

test('los modales caben en la pantalla: crear lista desde el móvil', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);

	await page.getByRole('button', { name: 'New list' }).first().click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog).toBeVisible();

	// El modal-box (max-w-md con los márgenes de daisyUI) entra entero en el
	// viewport del teléfono: es el «adaptado a pantalla pequeña» de la checklist.
	const box = await dialog.locator('.modal-box').boundingBox();
	expect(box).not.toBeNull();
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(
		(await page.evaluate(() => document.documentElement.clientWidth)) + 1
	);

	// Y el flujo completo funciona con el teclado táctil: crear y ver el toast.
	await dialog.locator('input[name="name"]').fill('Frutería');
	await dialog.getByRole('button', { name: 'New list' }).click();
	await expect(page.getByRole('status')).toContainText('List created: it now shows in the view.');
});

test('el idioma inicial sale de Accept-Language, el selector lo cambia y persiste', async ({
	page
}) => {
	// Nombre fijo: la cabecera del home es el saludo (#161) y las aserciones
	// necesitan un texto determinista en cada idioma.
	const user = await createUser({ name: 'Navegante' });
	await createFamily({ owner: user });
	await seedSession(page, user);

	// Primera visita sin cookie: el `Accept-Language: en-US` del dispositivo
	// elige inglés (estrategia `preferredLanguage`, issue #78).
	await page.goto('/');
	await waitForHydration(page);
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByRole('heading', { name: 'Hi, Navegante' })).toBeVisible();

	// Cambio a español: setLocale escribe la cookie de Paraglide y recarga.
	await page.getByRole('button', { name: 'Change language' }).click();
	await page.getByRole('menuitemradio', { name: 'Español' }).click();

	// Tras la recarga, todo el chrome sale en español — incluido el dock.
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');
	await expect(page.getByRole('heading', { name: 'Hola, Navegante' })).toBeVisible();
	const dock = page.getByRole('navigation', { name: 'Navegación inferior' });
	await expect(dock).toBeVisible();
	await expectNoOverflow(page);

	// La cookie persiste: otra recarga sigue en español.
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');
	await expect(page.getByRole('heading', { name: 'Hola, Navegante' })).toBeVisible();
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
