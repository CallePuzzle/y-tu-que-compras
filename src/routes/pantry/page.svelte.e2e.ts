import { expect, test } from '@playwright/test';
import { switchBackToTab } from '../../../e2e/helpers/browser';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import {
	createCategory,
	createFamily,
	createItem,
	createList,
	createPantryItem,
	createUser,
	resetDb
} from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('sin familia elegida manda a /families, y con una sola la elige sola', async ({ page }) => {
	const user = await createUser();
	// Dos familias: hay decisión que tomar, así que /pantry no entra.
	const familyA = await createFamily({ name: 'Familia A', owner: user });
	await createFamily({ name: 'Familia B', owner: user });

	await seedSession(page, user);
	await page.goto('/pantry');
	await expect(page).toHaveURL(/\/families$/);

	// Una sola familia: selección automática (issue #63), la despensa funciona
	// sin preguntar nada.
	// Sin roles antes que sin miembros: el trigger de la BD no deja quitar al
	// último admin de una familia que sigue viva (issue #104).
	await prisma.role.deleteMany({ where: { contextId: familyA.id } });
	await prisma.member.deleteMany({ where: { contextId: familyA.id } });
	await page.goto('/pantry');
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByRole('heading', { name: 'Tu despensa' })).toBeVisible();
});

test('estado vacio con CTA hacia las listas', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);

	await expect(page.getByText(/La despensa está vacía/)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Ir a las listas' })).toBeVisible();
});

test('muestra los productos con nombre, cantidad y unidad', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		quantity: 1.5,
		unit: 'liter'
	});
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 1, unit: 'unit' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);

	const leche = page.locator('li', { hasText: 'Leche entera' });
	await expect(leche).toBeVisible();
	await expect(leche.getByText('1,5 L')).toBeVisible();
	const pan = page.locator('li', { hasText: 'Pan' });
	await expect(pan).toBeVisible();
	await expect(pan.getByText('1 ud')).toBeVisible();
});

test('los productos de otras familias no se ven', async ({ page }) => {
	const user = await createUser();
	const ownFamily = await createFamily({ name: 'Familia Mía', owner: user });
	await createPantryItem({
		familyId: ownFamily.id,
		name: 'Leche entera',
		quantity: 1,
		unit: 'liter'
	});
	const other = await createUser();
	const otherFamily = await createFamily({ name: 'Familia Ajena', owner: other });
	await createPantryItem({ familyId: otherFamily.id, name: 'Caviar', quantity: 1, unit: 'unit' });
	await seedSession(page, user);

	// La activa es la única familia del usuario (selección automática).
	await page.goto('/pantry');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Leche entera' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Caviar' })).toHaveCount(0);
});

test('al volver a la pestaña se actualiza con lo comprado por otro miembro (#44)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 1, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	await expect(page.locator('li', { hasText: 'Leche entera' })).toBeVisible();
	// El contador va acotado a la sección de contenido: el menú también pinta
	// `li` (entradas de navegación).
	await expect(page.locator('section li')).toHaveCount(1);

	// «Otro miembro» finaliza una compra mientras miramos: su comprado aterriza
	// en la despensa (lo que deja `finalizePurchase`)…
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 2, unit: 'unit' });
	// …y al volver a la pestaña la despensa se repinta sin recargar.
	await switchBackToTab(page);
	await expect(page.locator('li', { hasText: 'Pan' })).toBeVisible();
	await expect(page.locator('section li')).toHaveCount(2);
});

test('el menu de navegacion lleva a la despensa', async ({ page }) => {
	const user = await createUser();
	await createFamily({ owner: user });
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);
	await page.getByRole('link', { name: 'Despensa' }).first().click();
	await expect(page).toHaveURL(/\/pantry$/);
	await expect(page.getByRole('heading', { name: 'Tu despensa' })).toBeVisible();
});

test('consumir quita el paso y al llegar a 0 el producto baja a Agotados (#73)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 2, unit: 'unit' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const pan = page.locator('li', { hasText: 'Pan' });

	// Dos consumos de 1 ud: 2 → 1 → 0.
	await pan.getByRole('button', { name: 'Consumir 1 ud' }).click();
	await expect(pan.getByText('1 ud')).toBeVisible();
	await pan.getByRole('button', { name: 'Consumir 1 ud' }).click();

	// Agotado NO es borrado: la fila baja a la sección «Agotados», atenuada,
	// sin botón de consumir (de 0 no se consume) y con el re-añadir a punto.
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();
	await expect(pan.getByText('0 ud')).toBeVisible();
	await expect(pan.getByRole('button', { name: 'Consumir 1 ud' })).toHaveCount(0);
	await expect(pan.getByRole('button', { name: 'Re-añadir a la compra' })).toBeVisible();

	// Y devolver un paso lo reponer: vuelve a «En casa» sin cabeceras que sobren.
	await pan.getByRole('button', { name: 'Devolver 1 ud' }).click();
	await expect(pan.getByText('1 ud')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Agotados' })).toHaveCount(0);
});

test('los kilos bajan a cuartos hasta agotarse (#73)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		quantity: 0.5,
		unit: 'kilogram'
	});
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });

	await leche.getByRole('button', { name: 'Consumir 0,25 kg' }).click();
	await expect(leche.getByText('0,25 kg')).toBeVisible();
	await leche.getByRole('button', { name: 'Consumir 0,25 kg' }).click();
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();
	await expect(leche.getByText('0 kg')).toBeVisible();
});

// El valor que pinta el badge MIENTRAS el POST viaja es el optimista, y el
// servidor no lo corrije hasta que responde: para poder observarlo, las dos
// pruebas siguientes retrasan la respuesta de `?/adjust` interceptándola y
// ASSERTIONES con timeout acotado — uno generoso esperaría la corrección del
// servidor y daría por bueno cualquier valor.
test('el contador optimista aplica el paso de la unidad, kg y g (#113)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		quantity: 0.5,
		unit: 'kilogram'
	});
	await createPantryItem({ familyId: family.id, name: 'Sal fina', quantity: 500, unit: 'gram' });
	await seedSession(page, user);

	await page.route(/\/pantry\?\/adjust/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 2_500));
		await route.continue();
	});

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });

	// kg: 0,5 − 0,25 = 0,25 en el MISMO instante del click, antes de que el
	// servidor (2,5 s) pueda decir nada. El bug pintaba 0 (0,5 − 1 recortado):
	// el producto saltaba a «Agotados» y desaparecía el botón de consumir,
	// aunque el servidor fuera a guardar 0,25.
	await leche.getByRole('button', { name: 'Consumir 0,25 kg' }).click();
	await expect(leche.getByText('0,25 kg')).toBeVisible({ timeout: 1_000 });
	await expect(page.getByRole('heading', { name: 'Agotados' })).toHaveCount(0, { timeout: 1_000 });
	await expect(leche.getByRole('button', { name: 'Consumir 0,25 kg' })).toBeVisible({
		timeout: 1_000
	});

	// g: 500 − 100 = 400, no 499 (el ±1 genérico del bug).
	const sal = page.locator('li', { hasText: 'Sal fina' });
	await sal.getByRole('button', { name: 'Consumir 100 g' }).click();
	await expect(sal.getByText('400 g')).toBeVisible({ timeout: 1_000 });

	// Llegan las respuestas: el servidor confirma exactamente lo pintado.
	await page.unroute(/\/pantry\?\/adjust/);
	await expect(leche.getByText('0,25 kg')).toBeVisible();
	await expect(sal.getByText('400 g')).toBeVisible();
});

test('los clics en vuelo no pierden su delta al resolver la primera petición (#113)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		quantity: 0.5,
		unit: 'kilogram'
	});
	await seedSession(page, user);

	// La primera petición resuelve enseguida; la segunda, mucho después: hay
	// una ventana ancha en la que UNA ha resuelto y la OTRA sigue en vuelo.
	let enCurso = 0;
	await page.route(/\/pantry\?\/adjust/, async (route) => {
		enCurso += 1;
		await new Promise((resolve) => setTimeout(resolve, enCurso === 1 ? 400 : 3_000));
		await route.continue();
	});

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });

	// Dos devoluciones rápidas: el optimista acumula 0,5 + 0,25 + 0,25 = 1 kg.
	await leche.getByRole('button', { name: 'Devolver 0,25 kg' }).click();
	await leche.getByRole('button', { name: 'Devolver 0,25 kg' }).click();
	await expect(leche.getByText('1 kg')).toBeVisible({ timeout: 1_000 });

	// ~1 s después de los clicks la primera petición ya ha resuelto (el
	// servidor va por 0,75 y su load ha llegado) y la segunda sigue en vuelo:
	// al retirar SOLO su delta, el badge se mantiene en 1 kg. El bug borraba
	// la entrada entera y el badge caía a 0,75 para luego volver a 1. El
	// timeout corto evita que la aserción espere a la segunda respuesta.
	await page.waitForTimeout(1_000);
	await expect(leche.getByText('1 kg')).toBeVisible({ timeout: 250 });
	await expect(leche.getByText('0,75 kg')).toHaveCount(0, { timeout: 250 });

	// Resuelve la segunda: el servidor confirma el 1 kg final.
	await page.waitForTimeout(2_500);
	await expect(leche.getByText('1 kg')).toBeVisible();
});

test('devolver (+) repone el paso consumido por error (#73)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Cerveza', quantity: 1, unit: 'unit' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const cerveza = page.locator('li', { hasText: 'Cerveza' });

	await cerveza.getByRole('button', { name: 'Devolver 1 ud' }).click();
	await expect(cerveza.getByText('2 ud')).toBeVisible();
});

test('re-añade a la lista que elijas y la despensa queda igual por defecto (#74)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const listA = await createList({ familyId: family.id, name: 'Super' });
	const listB = await createList({ familyId: family.id, name: 'Mercado' });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });
	await leche.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Re-añadir «Leche entera»' })).toBeVisible();
	// La cantidad por defecto para la lista es la que hay en despensa.
	await expect(dialog.locator('#readd-quantity')).toHaveValue('2');
	// Sin preguntas sobre la despensa (#149): el producto se queda como está.
	await expect(dialog.getByText('¿Qué hago con la despensa?')).toHaveCount(0);
	// El destino puede ser cualquiera: se elige la SEGUNDA lista.
	await dialog.locator('#readd-list').selectOption({ label: 'Mercado' });
	await dialog.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	// El modal cierra, avisa y la despensa sigue igual (leave as is por defecto).
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Añadido a la lista de la compra.');
	await expect(leche.getByText('2 L')).toBeVisible();

	// El item está en la lista elegida y no en la otra.
	await page.goto(`/lists/${listB.id}`);
	await expect(
		page.locator('section li', { hasText: 'Leche entera' }).getByText('2 L')
	).toBeVisible();
	await page.goto(`/lists/${listA.id}`);
	await expect(page.locator('section li', { hasText: 'Leche entera' })).toHaveCount(0);
});

test('re-añadir suma sobre el pendiente equivalente de la lista (#74)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createItem({ listId: list.id, name: 'leche entera', quantity: 0.5, unit: 'liter' });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });
	await leche.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	const dialog = page.locator('dialog[open]');
	// Cantidad para la lista distinta a la de despensa: 1 L.
	await dialog.locator('#readd-quantity').fill('1');
	await dialog.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	await expect(page.getByRole('status')).toContainText('Añadido a la lista de la compra.');
	// 0,5 + 1 = 1,5 sobre UNA fila (sin duplicado), conservando el nombre escrito.
	await page.goto(`/lists/${list.id}`);
	await expect(
		page.locator('section li', { hasText: 'leche entera' }).getByText('1,5 L')
	).toBeVisible();
	await expect(page.locator('section li')).toHaveCount(1);
});

test('sin listas el modal explica que hay que crear una (#74)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	await page
		.locator('li', { hasText: 'Leche entera' })
		.getByRole('button', { name: 'Re-añadir a la compra' })
		.click();

	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByText(/Esta familia no tiene listas/)).toBeVisible();
	// Sin listas no hay formulario que enviar.
	await expect(dialog.getByRole('button', { name: 'Re-añadir a la compra' })).toHaveCount(0);
});

test('un agotado se re-añade a la compra y se queda en la despensa a cero (#74)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const list = await createList({ familyId: family.id, name: 'Super' });
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 1, unit: 'unit' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const pan = page.locator('li', { hasText: 'Pan' });

	// Lo consumo hasta agotarlo…
	await pan.getByRole('button', { name: 'Consumir 1 ud' }).click();
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();

	// …y desde agotado lo mando a la lista: es la memoria de la compra.
	await pan.getByRole('button', { name: 'Re-añadir a la compra' }).click();
	const dialog = page.locator('dialog[open]');
	// El cero no puede ser la cantidad a comprar: se propone 1 paso.
	await expect(dialog.locator('#readd-quantity')).toHaveValue('1');
	await dialog.getByRole('button', { name: 'Re-añadir a la compra' }).click();

	await expect(page.getByRole('status')).toContainText('Añadido a la lista de la compra.');
	// El agotado sigue en la despensa…
	await expect(pan.getByText('0 ud')).toBeVisible();
	// …y el item espera en la lista.
	await page.goto(`/lists/${list.id}`);
	await expect(page.locator('section li', { hasText: 'Pan' }).getByText('1 ud')).toBeVisible();
});

// El valor que pinta el badge MIENTRAS el POST viaja es el optimista, y el
// servidor no lo corrige hasta que responde: para poder observarlo, las dos
// pruebas siguientes retrasan la respuesta de `?/adjust` interceptándola y
// ASSERTIONES con timeout acotado — uno generoso esperaría la corrección del
// servidor y daría por bueno cualquier valor.
test('consumir a cero de un tirón se guarda: al recargar sigue agotado (#148)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 1, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });

	// Congelo las respuestas del ajuste: los cuatro clics se apilan sin que
	// ninguna respuesta reordene la página por el camino. Con el bug, el
	// optimista del 4.º click (pintado en el `onclick`) movía la fila a
	// «Agotados» y desmontaba el `<form>` antes de que el navegador disparase
	// el submit: el ajuste quedaba pintado SIN petición y la base conservaba
	// 0,25 — al recargar, el producto «dejaba de estar agotado».
	await page.route(/\/pantry\?\/adjust/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 2_500));
		await route.continue();
	});

	// Cuatro consumos seguidos: 1 → 0,75 → 0,5 → 0,25 → 0.
	for (let i = 0; i < 4; i++) {
		await leche.getByRole('button', { name: 'Consumir 0,25 L' }).click();
	}

	// El optimista llega a 0 y el producto baja a «Agotados»…
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();
	await expect(leche.getByText('0 L')).toBeVisible();

	// …y desde el arreglo, todo optimista implica un POST en vuelo: la base
	// acaba en 0 (con el clamp del servidor), no en un resto tipo 0,25.
	await page.unroute(/\/pantry\?\/adjust/);
	await page.waitForLoadState('networkidle');
	await expect
		.poll(async () => {
			const row = await prisma.pantryItem.findFirst({ where: { name: 'Leche entera' } });
			return Number(row?.quantity);
		})
		.toBe(0);

	// La prueba que pide la issue: recargar no miente — sigue agotado a cero.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'Leche entera' }).getByText('0 L')).toBeVisible();
});

// El ajuste se confirma con dos pasos: la respuesta del POST y el refresco
// del load que la sigue. Este test retrasa SOLO el refresco para observar la
// ventana entre los dos: retirar el optimista antes de que aterrice la
// verdad pintaba un instante la cantidad vieja y la fila «volvía a En casa»
// para reaparecer en Agotados (#148).
test('al agotarse la fila no baila: se queda en Agotados mientras aterriza el refresco (#148)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		quantity: 0.25,
		unit: 'liter'
	});
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const leche = page.locator('li', { hasText: 'Leche entera' });

	// El refresco de datos que dispara la confirmación tardará 2 s: la
	// ventana «respuesta aplicada, verdad aún en vuelo» se vuelve observable.
	await page.route(
		(url) => url.pathname.endsWith('__data.json'),
		async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 2_000));
			await route.continue();
		}
	);

	// Un consumo lleva el producto a 0: el optimista lo baja a Agotados.
	await leche.getByRole('button', { name: 'Consumir 0,25 L' }).click();
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();

	// DURANTE la ventana (timeout menor que el retraso): la respuesta ya se
	// aplicó y la fila NO puede volver a En casa pintando la cantidad vieja.
	await expect(leche.getByText('0,25 L')).toHaveCount(0, { timeout: 1_000 });
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible({ timeout: 1_000 });

	// Aterrizado el refresco, el estado final es el mismo agotado a cero.
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Agotados' })).toBeVisible();
	await expect(leche.getByText('0 L')).toBeVisible();
	await expect
		.poll(async () => {
			const row = await prisma.pantryItem.findFirst({ where: { name: 'Leche entera' } });
			return Number(row?.quantity);
		})
		.toBe(0);
});

test('el agotado se puede quitar de la despensa con confirmación (#148)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 0, unit: 'unit' });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);
	const pan = page.locator('li', { hasText: 'Pan' });
	const leche = page.locator('li', { hasText: 'Leche entera' });

	// Solo el agotado ofrece quitarlo; el que tiene existencias no.
	await expect(pan.getByRole('button', { name: 'Quitar de la despensa' })).toBeVisible();
	await expect(leche.getByRole('button', { name: 'Quitar de la despensa' })).toHaveCount(0);

	// Primero la confirmación: escapar deja la despensa como estaba.
	await pan.getByRole('button', { name: 'Quitar de la despensa' }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByText('¿Quitar «Pan» de la despensa?')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(pan).toBeVisible();

	// Confirmar quita el producto: fuera de la vista y de la base.
	await pan.getByRole('button', { name: 'Quitar de la despensa' }).click();
	await dialog.getByRole('button', { name: 'Quitar', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Producto quitado de la despensa.');
	await expect(pan).toHaveCount(0);
	await expect(prisma.pantryItem.findFirst({ where: { name: 'Pan' } })).resolves.toBeNull();

	// La leche sigue en su sitio y la sección Agotados ya no hace falta.
	await expect(leche).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Agotados' })).toHaveCount(0);
});

test('agrupa por categorias en su orden y deja Sin categoria al final (#176)', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const dairy = await createCategory({ familyId: family.id, name: 'Lácteos', position: 0 });
	const fruits = await createCategory({ familyId: family.id, name: 'Frutas', position: 1 });
	await createPantryItem({
		familyId: family.id,
		name: 'Yogur',
		quantity: 4,
		unit: 'unit',
		categoryId: dairy.id
	});
	await createPantryItem({
		familyId: family.id,
		name: 'Manzana',
		quantity: 1,
		unit: 'kilogram',
		categoryId: fruits.id
	});
	// Sin categoría: los dos últimos, que el orden de secciones los lleva al final.
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await createPantryItem({ familyId: family.id, name: 'Pan', quantity: 1, unit: 'unit' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);

	// Las secciones salen en el orden de la familia (posición) y «Sin
	// categoría» al final; una categoría sin productos aquí no abre sección.
	// La cabecera colapsable (#209) añade a cada título su contador de
	// productos: el `\s*` tolera los renglones que el navegador mete entre
	// chevron, título y contador.
	const titulos = page.locator('#tour-pantry-list h3');
	await expect(titulos).toHaveText([
		/^\s*Lácteos\s*1$/,
		/^\s*Frutas\s*1$/,
		/^\s*Sin categoría\s*2$/
	]);

	// Cada producto en SU sección.
	await expect(
		page.getByRole('region', { name: 'Lácteos' }).locator('li', { hasText: 'Yogur' })
	).toBeVisible();
	await expect(
		page.getByRole('region', { name: 'Frutas' }).locator('li', { hasText: 'Manzana' })
	).toBeVisible();
	const uncategorized = page.getByRole('region', { name: 'Sin categoría' });
	await expect(uncategorized.locator('li', { hasText: 'Leche entera' })).toBeVisible();
	await expect(uncategorized.locator('li', { hasText: 'Pan' })).toBeVisible();

	// El badge de cada fila muestra su categoría — o su sitio para darle una.
	await expect(
		page.locator('li', { hasText: 'Yogur' }).getByRole('button', { name: 'Cambiar categoría' })
	).toContainText('Lácteos');
	await expect(
		page
			.locator('li', { hasText: 'Leche entera' })
			.getByRole('button', { name: 'Cambiar categoría' })
	).toContainText('Sin categoría');
});

test('recategoriza un producto desde la despensa y las secciones se reordenan (#176)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const dairy = await createCategory({ familyId: family.id, name: 'Lácteos', position: 0 });
	await createPantryItem({
		familyId: family.id,
		name: 'Yogur',
		quantity: 4,
		unit: 'unit',
		categoryId: dairy.id
	});
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);

	// La leche, sin categoría, abre el modal desde SU badge.
	const leche = page.locator('li', { hasText: 'Leche entera' });
	await leche.getByRole('button', { name: 'Cambiar categoría' }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Categoría de «Leche entera»' })).toBeVisible();
	// El select trae la categoría actual: sin categoría.
	await expect(dialog.locator('#recat-category')).toHaveValue('');

	// La familia elige Lácteos y guarda.
	await dialog.locator('#recat-category').selectOption({ label: 'Lácteos' });
	await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

	// El modal cierra, avisa y la leche aparece EN Lácteos: la sección «Sin
	// categoría» desaparece al quedarse vacía.
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Categoría actualizada.');
	await expect(
		page.getByRole('region', { name: 'Lácteos' }).locator('li', { hasText: 'Leche entera' })
	).toBeVisible();
	await expect(page.getByRole('region', { name: 'Sin categoría' })).toHaveCount(0);
	await expect
		.poll(async () => {
			const row = await prisma.pantryItem.findFirst({ where: { name: 'Leche entera' } });
			return row?.categoryId;
		})
		.toBe(dairy.id);

	// Y al revés: devolver el yogur a «Sin categoría» lo baja de sección.
	const yogur = page.locator('li', { hasText: 'Yogur' });
	await yogur.getByRole('button', { name: 'Cambiar categoría' }).click();
	await expect(dialog.getByRole('heading', { name: 'Categoría de «Yogur»' })).toBeVisible();
	await expect(dialog.locator('#recat-category')).toHaveValue(dairy.id);
	await dialog.locator('#recat-category').selectOption({ label: 'Sin categoría' });
	await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

	await expect(page.getByRole('region', { name: 'Sin categoría' })).toBeVisible();
	await expect(
		page.getByRole('region', { name: 'Sin categoría' }).locator('li', { hasText: 'Yogur' })
	).toBeVisible();
});

test('sin categorias en la familia la despensa queda plana, sin secciones (#176)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	await createPantryItem({ familyId: family.id, name: 'Leche entera', quantity: 2, unit: 'liter' });
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);

	// Sin categorías no hay secciones ni badges: la lista queda como siempre.
	await expect(page.locator('#tour-pantry-list h3')).toHaveCount(0);
	await expect(page.locator('li', { hasText: 'Leche entera' })).toBeVisible();
	await expect(
		page
			.locator('li', { hasText: 'Leche entera' })
			.getByRole('button', { name: 'Cambiar categoría' })
	).toHaveCount(0);
});

test('las secciones se colapsan desde su cabecera y el estado sobrevive a la recarga (#209)', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const dairy = await createCategory({ familyId: family.id, name: 'Lácteos', position: 0 });
	await createPantryItem({
		familyId: family.id,
		name: 'Yogur',
		quantity: 4,
		unit: 'unit',
		categoryId: dairy.id
	});
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		quantity: 2,
		unit: 'liter',
		categoryId: dairy.id
	});
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);

	// Por defecto TODO expandido: la vista de hoy no cambia (#209).
	const cabecera = page.locator(`#casa-${dairy.id} button`);
	const lista = page.locator(`#casa-${dairy.id}-list`);
	await expect(cabecera).toHaveAttribute('aria-expanded', 'true');
	await expect(cabecera).toHaveAttribute('aria-controls', `casa-${dairy.id}-list`);
	await expect(lista).toBeVisible();
	await expect(lista.locator('li')).toHaveCount(2);

	// Colapsar: la lista se retira, el chevron gira y el nombre accesible
	// pasa a ofrecer expandir.
	await cabecera.click();
	await expect(cabecera).toHaveAttribute('aria-expanded', 'false');
	await expect(lista).toBeHidden();
	await expect(cabecera.locator('svg')).toHaveClass(/-rotate-90/);
	await expect(cabecera).toHaveAttribute('aria-label', 'Expandir Lácteos');

	// El estado viaja a localStorage con SU clave de sección.
	const collapsed = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('pantry-collapsed-v1') ?? '[]')
	);
	expect(collapsed).toEqual([`casa-${dairy.id}`]);

	// La recarga lo retoma: sigue plegada…
	await page.reload();
	await waitForHydration(page);
	await expect(page.locator(`#casa-${dairy.id}-list`)).toBeHidden();
	await expect(page.locator(`#casa-${dairy.id} button`)).toHaveAttribute('aria-expanded', 'false');

	// …y expandir de nuevo la devuelve y vacía el recuerdo.
	await page.locator(`#casa-${dairy.id} button`).click();
	await expect(page.locator(`#casa-${dairy.id}-list`)).toBeVisible();
	const raw = await page.evaluate(() => localStorage.getItem('pantry-collapsed-v1'));
	expect(JSON.parse(raw ?? '[]')).toEqual([]);
});

test('En casa y Agotados recuerdan su colapsado por separado (#209)', async ({ page }) => {
	// La misma categoría con producto en casa y agotado: dos secciones con el
	// mismo título, cada una con SU clave (`casa-<id>` / `fuera-<id>`).
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const dairy = await createCategory({ familyId: family.id, name: 'Lácteos', position: 0 });
	await createPantryItem({
		familyId: family.id,
		name: 'Yogur',
		quantity: 4,
		unit: 'unit',
		categoryId: dairy.id
	});
	await createPantryItem({
		familyId: family.id,
		name: 'Leche entera',
		quantity: 0,
		unit: 'liter',
		categoryId: dairy.id
	});
	await seedSession(page, user);

	await page.goto('/pantry');
	await waitForHydration(page);

	const casa = page.locator(`#casa-${dairy.id} button`);
	const fuera = page.locator(`#fuera-${dairy.id} button`);
	await expect(casa).toHaveAttribute('aria-expanded', 'true');
	await expect(fuera).toHaveAttribute('aria-expanded', 'true');

	// Plegar SOLO la de casa: la de agotados queda abierta…
	await casa.click();
	await expect(page.locator(`#casa-${dairy.id}-list`)).toBeHidden();
	await expect(page.locator(`#fuera-${dairy.id}-list`)).toBeVisible();
	await expect(fuera).toHaveAttribute('aria-expanded', 'true');

	// …y el recuerdo guarda SOLO la clave plegada, sin contagio.
	const raw = await page.evaluate(() => localStorage.getItem('pantry-collapsed-v1'));
	expect(JSON.parse(raw ?? '[]')).toEqual([`casa-${dairy.id}`]);

	// Recarga: el reparto se conserva tal cual.
	await page.reload();
	await waitForHydration(page);
	await expect(page.locator(`#casa-${dairy.id}-list`)).toBeHidden();
	await expect(page.locator(`#fuera-${dairy.id}-list`)).toBeVisible();
});
