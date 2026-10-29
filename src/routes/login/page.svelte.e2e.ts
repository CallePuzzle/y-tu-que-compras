import { expect, test } from '@playwright/test';
import { loginViaUi, waitForHydration } from '../../../e2e/helpers/auth';
import { createUser, resetDb } from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('la pagina de login muestra el formulario de email', async ({ page }) => {
	await page.goto('/login');

	// Indiferente al idioma: el input de email y los dos pasos del flujo
	// (email y codigo) existen en cualquiera de las dos locales. No se envia
	// el formulario: en preview no hay SMTP y el envio del codigo fallaria.
	await expect(page.locator('input[name="email"]')).toBeVisible();
	await expect(page.locator('ul.steps > li')).toHaveCount(2);
});

test('login completo por OTP: pide el codigo, lo canjea y vuelve a la pagina pedida', async ({
	page
}) => {
	const user = await createUser({ email: 'login-e2e@e2e.test', name: 'Papá' });

	// Ruta privada como punto de partida: el guard manda al login con
	// `redirectTo` y el canje del código devuelve a ella.
	await loginViaUi(page, user.email, '/families');

	await expect(page).toHaveURL(/\/families$/);
	// Con sesión la cabecera ya no ofrece «Acceder»: sale el selector de
	// familia (sin familias: su CTA de crear) en lugar del enlace al login.
	await expect(page.getByRole('link', { name: 'Acceder' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Crear familia' })).toBeVisible();
});

test('la sesion sobrevive a una recarga', async ({ page }) => {
	const user = await createUser({ email: 'login-e2e@e2e.test' });
	// Ruta privada sin requisito de familia: `/` es la landing pública (#133)
	// y `/lists` mandaría a /families sin familia elegida (#63).
	await loginViaUi(page, user.email, '/families');

	// Recarga: la cookie de sesión (firmada) vuelve a validar en el servidor
	// y no hay formulario de login delante (la vista de familias, no el login;
	// el `input[name="email"]` de la modal de invitar va oculto en el DOM).
	await page.reload();
	await expect(page).toHaveURL(/\/families$/);
	await expect(page.getByRole('heading', { name: 'Tus familias' })).toBeVisible();
});

test('un codigo invalido no abre sesion y lo dice en el paso 2', async ({ page }) => {
	const user = await createUser({ email: 'login-e2e@e2e.test' });

	await page.goto('/login');
	await waitForHydration(page);
	await page.locator('input[name="email"]').fill(user.email);
	await page.getByRole('button', { name: 'Iniciar sesión' }).click();

	// El OTP real existe en la BD, pero se teclea otro: better-auth lo rechaza
	// (resta un intento) y el formulario se queda en el paso 2 con el aviso.
	const otpInput = page.locator('input[autocomplete="one-time-code"]');
	await otpInput.waitFor();
	await otpInput.pressSequentially('000000');

	await expect(
		page.getByText('Ese código no es válido. Compruébalo e inténtalo de nuevo.')
	).toBeVisible();
	await expect(page).toHaveURL(/\/login/);
});
