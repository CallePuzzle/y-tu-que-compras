import { expect, test } from '@playwright/test';
import { readOtp, seedSession, waitForHydration } from '../../e2e/helpers/auth';
import { createUser, resetDb } from '../../e2e/helpers/seed';

test('sin sesion, una ruta privada redirige a /login conservando la url', async ({ page }) => {
	// `/lists` y no `/`: la portada es la landing pública (#133), ya no redirige.
	await page.goto('/lists');
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Flists$/);

	// Una ruta profunda, con query: tras el login se debe volver a ella.
	await page.goto('/families/45?orden=asc');
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Ffamilies%2F45%3Forden%3Dasc$/);
});

test('sin sesion, la portada muestra la landing publica (#133)', async ({ page }) => {
	await page.goto('/');

	// Sin redirección: la landing completa se pinta en la propia portada.
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('heading', { level: 1, name: '¿Y tú qué compras?' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Cómo funciona' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Todo lo que puedes hacer' })).toBeVisible();

	// El CTA (el del hero; el de cierre repite destino) manda a acceder.
	const cta = page.getByRole('main').getByRole('link', { name: 'Acceder' }).first();
	await expect(cta).toBeVisible();
	await expect(cta).toHaveAttribute('href', '/login');
});

test('con sesion, la portada es el home con saludo y accesos (#161)', async ({ page }) => {
	await resetDb();
	const user = await createUser({ name: 'Ana' });
	await seedSession(page, user);

	// `seedSession` siembra el tour como visto para no bloquear al resto de
	// specs: aquí lo re-armamos, porque ESTE es el test de su arranque (#142).
	// Los init scripts corren en orden de registro: tras el suyo que fija la
	// clave, este la quita y la primera visita a `/` arranca el tour.
	await page.addInitScript(() => localStorage.removeItem('onboarding-tour-v1'));

	await page.goto('/');

	// Saludo con el nombre (#161); de la landing pública (#133), nada.
	await expect(page.getByRole('heading', { level: 1, name: 'Hola, Ana' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Cómo funciona' })).toHaveCount(0);

	// Los accesos del home: los seis del menú de sesión. A las listas (el
	// ancla del tour), historial, categorías (#164) y establecimientos
	// (#177) se suman ahora despensa y familias; cada tarjeta añade bajo la
	// etiqueta su línea descriptiva (`home_*_text`).
	const accesos = [
		{ nombre: 'Listas', href: '/lists' },
		{ nombre: 'Despensa', href: '/pantry' },
		{ nombre: 'Historial', href: '/history' },
		{ nombre: 'Categorías', href: '/categories' },
		{ nombre: 'Establecimientos', href: '/stores' },
		{ nombre: 'Familias', href: '/families' }
	];
	for (const acceso of accesos) {
		await expect(page.getByRole('main').getByRole('link', { name: acceso.nombre })).toHaveAttribute(
			'href',
			acceso.href
		);
	}
	await expect(page.getByRole('main').getByRole('link', { name: 'Listas' })).toBeVisible();

	// El tour arranca con sesión y su paso 1 ancla el acceso a las listas (#142).
	const tour = page.locator('.tg-dialog');
	await expect(tour).toBeVisible();
	await expect(page.locator('#tour-home-cta')).toBeVisible();

	// Escape lo cierra y lo marca como visto: no volverá a arrancar solo.
	// La librería hace visible el diálogo ANTES de colgar sus listeners de
	// teclado, así que un Escape demasiado pronto no cuaja: se reintenta
	// hasta que el cierre llegue a un diálogo ya escuchando.
	await expect(async () => {
		await page.keyboard.press('Escape');
		await expect(tour).toBeHidden({ timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('onboarding-tour-v1')))
		.toContain('"finished":true');
});

test('tras el login sin redirectTo se aterriza en el home (#161)', async ({ page }) => {
	await resetDb();
	const user = await createUser({ email: 'home-e2e@e2e.test', name: 'Ana' });

	// Login directo en /login, sin `redirectTo`: canjeado el código, la app
	// manda a la portada (`onLoginSuccess` de /login) y ésta, con sesión,
	// pinta el home — no la landing (#133). El flujo OTP es el real, leyendo
	// el código de la tabla `verification` (ver e2e/helpers/auth).
	await page.goto('/login');
	await waitForHydration(page);
	await page.locator('input[name="email"]').fill(user.email);
	await page.getByRole('button', { name: 'Iniciar sesión' }).click();

	const otpInput = page.locator('input[autocomplete="one-time-code"]');
	await otpInput.waitFor();
	await otpInput.pressSequentially(await readOtp(user.email));

	await page.waitForURL((url) => url.pathname === '/');
	await expect(page.getByRole('heading', { level: 1, name: 'Hola, Ana' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Cómo funciona' })).toHaveCount(0);
});

test('la CSP no bloquea nada y llegan las cabeceras de seguridad', async ({ page }) => {
	// `/login` es pública: la respuesta no depende del guard.
	const violations: string[] = [];
	page.on('console', (message) => {
		if (message.text().includes('Content Security Policy')) violations.push(message.text());
	});

	const response = await page.goto('/login');
	await page.waitForLoadState('networkidle');

	expect(violations).toEqual([]);
	const headers = response?.headers() ?? {};
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
	expect(headers['x-content-type-options']).toBe('nosniff');
});

test('un 404 sale traducido y dentro del layout de la app (#118)', async ({ page }) => {
	await resetDb();
	const user = await createUser();
	await seedSession(page, user);

	const response = await page.goto('/no-existe');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { name: 'Error 404' })).toBeVisible();
	await expect(page.getByText('Esta página no existe o ya no está disponible.')).toBeVisible();
	// Con el layout: la navegación de la app sigue a mano.
	await expect(page.getByRole('link', { name: 'Listas' }).first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Volver al inicio' })).toBeVisible();
});
