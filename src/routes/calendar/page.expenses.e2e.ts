import { expect, test, type Page } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import {
	createFamily,
	createMealPlan,
	createPurchaseRecord,
	createStore,
	createUser,
	resetDb
} from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

// ----------------------------------------------------------------------------
// Claves de fecha, duplicadas aquí a PROPÓSITO (las mismas que el spec de
// menús de esta ruta): el mes en vista lo resuelve el SERVIDOR (`monthKeyOf`
// de `./grid.ts`) en la zona de la app (`APP_TIME_ZONE` de `#lib/format.js`)
// y el spec compone las mismas claves con la misma `Intl` para sembrar y
// pulsar los días — sin importar la ruta, que el proceso del test no pasa
// por Vite.
// ----------------------------------------------------------------------------
const APP_TIME_ZONE = 'Europe/Madrid';

/** Una parte de `formatToParts`, garantizada por haberla pedido al formatear. */
function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
	const value = parts.find((part) => part.type === type)?.value;
	if (value === undefined) throw new RangeError(`Intl no devolvió la parte ${type}`);
	return value;
}

/** El mes actual EN LA ZONA DE LA APP, como clave `YYYY-MM` (la de la query). */
function currentMonthKey(now = new Date()): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: APP_TIME_ZONE,
		year: 'numeric',
		month: '2-digit'
	}).formatToParts(now);
	return `${partOf(parts, 'year')}-${partOf(parts, 'month')}`;
}

/** El mes anterior o siguiente de una clave validada (`delta` negativo, atrás). */
function shiftMonth(monthKey: string, delta: number): string {
	const [year, month] = monthKey.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
	return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** La clave `YYYY-MM-DD` de UN día del mes: la identidad de las celdas. */
function dayKey(monthKey: string, day: number): string {
	return `${monthKey}-${String(day).padStart(2, '0')}`;
}

/**
 * El instante UTC de una hora de pared EN MADRID: el `createdAt` de una
 * compra se siembra como instante y la pared que hay que escribir cambia con
 * el DST (CET, UTC+1 en invierno; CEST, UTC+2 en verano). Se prueba con los
 * dos offsets y gana el que `Intl` confirma contra la zona de la app: así el
 * caso de las 00:30 del día 1 (#220) cae donde toca sea cual sea la estación
 * del runner.
 */
function madridInstant(wall: string): Date {
	for (const offset of ['+01:00', '+02:00']) {
		const candidate = new Date(`${wall}:00${offset}`);
		const parts = new Intl.DateTimeFormat('en', {
			timeZone: APP_TIME_ZONE,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		}).formatToParts(candidate);
		const observed = `${partOf(parts, 'year')}-${partOf(parts, 'month')}-${partOf(parts, 'day')}T${partOf(parts, 'hour')}:${partOf(parts, 'minute')}`;
		if (observed === wall) return candidate;
	}
	throw new RangeError(`La hora de pared ${wall} no existe en ${APP_TIME_ZONE}`);
}

/**
 * La vista del calendario en SU pestaña de gastos (#220): la vista por
 * defecto de /calendar es la de gastos (esqueleto #217), así que basta
 * entrar — sin pulsar pestaña alguna.
 */
async function openExpenses(page: Page): Promise<void> {
	await page.goto('/calendar');
	await waitForHydration(page);
}

/** El modal de gastos del día (#220): el único con SU heading. */
const modalGastos = (page: Page) =>
	page
		.locator('dialog[open]')
		.filter({ has: page.getByRole('heading', { name: 'Gastos del día' }) });

/** El detalle del día de MENÚS (#221): el único con SU heading. */
const modalMenus = (page: Page) =>
	page
		.locator('dialog[open]')
		.filter({ has: page.getByRole('heading', { name: 'Menús del día' }) });

test('el tab de gastos pinta el total del mes y la cifra de cada dia con compras', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	const anterior = shiftMonth(month, -1);
	const mercadona = await createStore({ familyId: family.id, name: 'Mercadona' });

	// Día 5: una compra suelta. Día 12: DOS compras que el día suma
	// (10,00 + 6,50 = 16,50). Día 25: un ticket de cuatro cifras para el
	// TRUNCADO compacto de celda (#220): la celda no da para más.
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra del dia 5',
		storeId: mercadona.id,
		storeName: 'Mercadona',
		total: 23.45,
		createdAt: madridInstant(`${month}-05T10:00`)
	});
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra del dia 12 a',
		total: 10,
		createdAt: madridInstant(`${month}-12T09:00`)
	});
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra del dia 12 b',
		total: 6.5,
		createdAt: madridInstant(`${month}-12T20:00`)
	});
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra del dia 25',
		total: 1234.56,
		createdAt: madridInstant(`${month}-25T18:00`)
	});
	// Y una del mes ANTERIOR: fuera del mes en vista no sale ni en celdas ni
	// en el total.
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra del mes pasado',
		total: 99,
		createdAt: madridInstant(`${anterior}-20T12:00`)
	});
	await seedSession(page, user);

	await openExpenses(page);

	// La cabecera del tab: el total del mes es la suma de SUS días (23,45 +
	// 16,50 + 1234,56), no la del contiguo.
	await expect(page.getByText('Total del mes')).toBeVisible();
	await expect(page.getByText('1274,51 €')).toBeVisible();

	// Cada día con compras, su cifra con el signo del gasto; el día 25, en
	// compacto a partir del millar (el precio completo no cabe en una celda;
	// el detalle completo lo enseña el modal de su día).
	await expect(page.getByRole('button', { name: '5 -23,45 €' })).toBeVisible();
	await expect(page.getByRole('button', { name: '12 -16,50 €' })).toBeVisible();
	await expect(page.getByRole('button', { name: '25 -1,2 mil €' })).toBeVisible();
	await expect(page.getByRole('button', { name: '25 -1.234,56 €' })).toHaveCount(0);

	// El día sin compras queda como estaba: número, no botón.
	await expect(page.getByRole('button', { name: '20', exact: true })).toHaveCount(0);

	// La compra del mes contiguo ni se pinta ni suma.
	await expect(page.getByRole('button', { name: '-99,00 €' })).toHaveCount(0);
});

test('la compra de las 00:30 (hora de Madrid) del dia 1 cae en el dia 1, no en el mes anterior', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();

	// El caso DST que motiva el rango ampliado de la query (#219) en la UI
	// (#220): medianoche y media del día 1 EN MADRID es, en UTC, la víspera
	// del mes (23:30 del último día del anterior en CET, 22:30 en CEST). La
	// clave del día la pone Madrid: tiene que pintarse en la celda del día 1
	// y sumar al total del mes EN VISTA, sea cual sea la estación.
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra de madrugada',
		total: 12,
		createdAt: madridInstant(`${month}-01T00:30`)
	});
	await seedSession(page, user);

	await openExpenses(page);

	// La cabecera suma la compra (exacto: la celda pinta SU cifra con el
	// signo del gasto y «-12,00 €» también contiene «12,00 €»).
	await expect(page.getByText('Total del mes')).toBeVisible();
	await expect(page.getByText('12,00 €', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: '1 -12,00 €' })).toBeVisible();
});

test('el detalle del dia lista sus compras con enlace a cada detalle del historial', async ({
	page
}) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	const mercadona = await createStore({ familyId: family.id, name: 'Mercadona' });
	const conTienda = await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra semanal',
		storeId: mercadona.id,
		storeName: 'Mercadona',
		total: 23.45,
		createdAt: madridInstant(`${month}-15T10:00`)
	});
	const sinTienda = await createPurchaseRecord({
		familyId: family.id,
		listName: 'Fruteria',
		total: 7.5,
		createdAt: madridInstant(`${month}-15T19:00`)
	});
	await seedSession(page, user);

	await openExpenses(page);

	// La celda del día (con SU cifra sumada) abre el modal de gastos.
	await page.getByRole('button', { name: '15 -30,95 €' }).click();
	const detalle = modalGastos(page);
	await expect(detalle.getByRole('heading', { name: 'Gastos del día' })).toBeVisible();
	await expect(detalle.getByText(dayKey(month, 15))).toBeVisible();

	// El total del día, SIEMPRE completo (30,95 = 23,45 + 7,50): la celda
	// abrevia, el modal no.
	await expect(detalle.getByText('Total del día')).toBeVisible();
	await expect(detalle.getByText('30,95 €')).toBeVisible();

	// Cada compra con su establecimiento (o el vacío) y su total, cada una
	// ENLAZANDO al detalle correcto del historial.
	const compras = detalle.getByRole('link');
	await expect(compras).toHaveCount(2);
	await expect(detalle.getByText('Mercadona')).toBeVisible();
	await expect(detalle.getByText('23,45 €')).toBeVisible();
	await expect(detalle.getByText('Sin establecimiento')).toBeVisible();
	await expect(detalle.getByText('7,50 €')).toBeVisible();
	await expect(compras.filter({ hasText: 'Mercadona' })).toHaveAttribute(
		'href',
		new RegExp(`/history/${conTienda.id}$`)
	);
	await expect(compras.filter({ hasText: 'Sin establecimiento' })).toHaveAttribute(
		'href',
		new RegExp(`/history/${sinTienda.id}$`)
	);

	// El día NO tiene menús: el otro detalle no se ofrece.
	await expect(detalle.getByRole('button', { name: 'Menús del día' })).toHaveCount(0);

	// Y el enlace lleva al detalle real del historial: el ticket completo.
	await compras.filter({ hasText: 'Mercadona' }).click();
	await expect(page).toHaveURL(new RegExp(`/history/${conTienda.id}$`));
	await expect(page.getByRole('heading', { name: 'Compra semanal' })).toBeVisible();
	await expect(page.getByText('23,45 €')).toBeVisible();
});

test('un dia con compras y menus: cada detalle lleva al otro, sin apilar', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	const dia = dayKey(month, 10);
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra del dia 10',
		storeName: 'Lidl',
		total: 20,
		createdAt: madridInstant(`${month}-10T13:00`)
	});
	await createMealPlan({
		familyId: family.id,
		dateKey: dia,
		mealType: 'lunch',
		title: 'Garbanzos'
	});
	await seedSession(page, user);

	await openExpenses(page);

	// Tab Gastos → celda del día → SU modal de gastos; el día también tiene
	// menús y lo ofrece con un botón…
	await page.getByRole('button', { name: '10 -20,00 €' }).click();
	const gastos = modalGastos(page);
	await expect(gastos.getByText('Lidl')).toBeVisible();
	await gastos.getByRole('button', { name: 'Menús del día' }).click();

	// …que NO apila: es un CAMBIO de vista del mismo día — el de gastos
	// queda cerrado y el de menús abierto con su contenido.
	await expect(gastos).toHaveCount(0);
	const menus = modalMenus(page);
	await expect(menus.getByRole('heading', { name: 'Garbanzos' })).toBeVisible();

	// Y en el otro sentido: el detalle de menús ofrece el de gastos, que
	// abre en su lugar con las compras del día.
	await menus.getByRole('button', { name: 'Gastos del día' }).click();
	await expect(menus).toHaveCount(0);
	const gastosDeVuelta = modalGastos(page);
	await expect(gastosDeVuelta.getByText('Total del día')).toBeVisible();
	// El día tiene UNA compra: su fila es el enlace con tienda y total.
	await expect(gastosDeVuelta.getByRole('link', { name: 'Lidl 20,00 €' })).toBeVisible();

	// Desde el tab de MENÚS, el mismo día abre el detalle de menús (el día
	// tiene menús) y AHÍ también queda a un botón el de gastos. Primero se
	// cierra el modal (escape): mientras esté abierto, el `<dialog>` nativo
	// tapa la página.
	await page.keyboard.press('Escape');
	await expect(modalGastos(page)).toHaveCount(0);
	await page.getByRole('tab', { name: 'Menú' }).click();
	await page.getByRole('button', { name: 'Garbanzos' }).click();
	const menusEnTab = modalMenus(page);
	await expect(menusEnTab.getByRole('button', { name: 'Gastos del día' })).toBeVisible();
	await menusEnTab.getByRole('button', { name: 'Gastos del día' }).click();
	await expect(modalGastos(page).getByRole('link', { name: 'Lidl 20,00 €' })).toBeVisible();
});

test('el mes sin compras muestra su estado vacio y ningun dia pulsable', async ({ page }) => {
	const user = await createUser();
	const family = await createFamily({ owner: user });
	const month = currentMonthKey();
	// La familia YA ha comprado… pero el mes ANTERIOR: el mes en vista sigue
	// vacío y su estado vacío manda sobre el total y las celdas.
	await createPurchaseRecord({
		familyId: family.id,
		listName: 'Compra del mes pasado',
		total: 42,
		createdAt: madridInstant(`${shiftMonth(month, -1)}-10T12:00`)
	});
	await seedSession(page, user);

	await openExpenses(page);

	await expect(
		page.getByText('Todavía no hay gastos este mes: se ven al finalizar una compra.')
	).toBeVisible();
	await expect(page.getByText('Total del mes')).toHaveCount(0);
	// Sin compras, ningún día del grid es botón: nada que abrir.
	await expect(page.getByRole('table').getByRole('button')).toHaveCount(0);
});
