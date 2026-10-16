import { expect, test } from '@playwright/test';

test('la pagina de login muestra el formulario de email', async ({ page }) => {
	await page.goto('/login');

	// Indiferente al idioma: el input de email y los dos pasos del flujo
	// (email y codigo) existen en cualquiera de las dos locales. No se envia
	// el formulario: en preview no hay SMTP y el envio del codigo fallaria.
	await expect(page.locator('input[name="email"]')).toBeVisible();
	await expect(page.locator('ul.steps > li')).toHaveCount(2);
});
