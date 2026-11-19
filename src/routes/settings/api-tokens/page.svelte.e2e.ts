import { expect, test } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../../e2e/helpers/auth';
import { prisma } from '../../../../e2e/helpers/db';
import { createUser, resetDb } from '../../../../e2e/helpers/seed';

// Página /settings/api-tokens (épica #260, tarea #273): crear tokens de API
// personales viéndolos UNA sola vez, listarlos y revocarlos. Los tokens son de
// la usuaria (plugin apiKey con sesión de cookie), así que los tests NO
// necesitan familia. El proyecto chromium corre en español.

test.beforeEach(async () => {
	await resetDb();
});

test('exige sesión: sin ella el guard manda al login conservando la ruta', async ({ page }) => {
	await page.goto('/settings/api-tokens');
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fsettings%2Fapi-tokens/);
});

test('la entrada de menú lleva a los ajustes y /settings redirige a los tokens', async ({
	page
}) => {
	const user = await createUser();
	await seedSession(page, user);

	await page.goto('/lists');
	await waitForHydration(page);
	// Dos enlaces con el mismo nombre (menú de escritorio y cajón lateral): el
	// primero es el del header, como en el spec de categorías.
	await page.getByRole('link', { name: 'Ajustes' }).first().click();
	await expect(page).toHaveURL(/\/settings\/api-tokens$/);
	await expect(page.getByRole('heading', { name: 'Tokens de API' })).toBeVisible();

	// La puerta genérica de ajustes vive y manda a la única sección que hay.
	await page.goto('/settings');
	await expect(page).toHaveURL(/\/settings\/api-tokens$/);
});

test('crear un token lo muestra UNA vez y la clave desaparece al cerrar el aviso', async ({
	page
}) => {
	const user = await createUser();
	await seedSession(page, user);

	await page.goto('/settings/api-tokens');
	await waitForHydration(page);

	// Estado vacío con CTA.
	await expect(page.getByText(/Todavía no tienes tokens de API/)).toBeVisible();
	await page.getByRole('button', { name: 'Crear token' }).first().click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="name"]').fill('Integración de prueba');
	await dialog.getByRole('button', { name: 'Crear token' }).click();

	// El modal cierra y la clave aparece EN CLARO, con el aviso de que es la
	// única vez que se ve.
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	const revealed = page.getByRole('status');
	await expect(revealed).toContainText('es la única vez que lo verás');
	const key = (await revealed.locator('code').textContent()) ?? '';
	expect(key.length).toBeGreaterThan(32);
	expect(key.startsWith('ytqc_')).toBe(true);

	// En la base solo está el hash: el plugin no guarda la clave en claro y el
	// servidor ya no podría servirla otra vez.
	const row = await prisma.apikey.findFirst({ where: { referenceId: user.id } });
	expect(row).not.toBeNull();
	expect(row?.key).not.toBe(key);
	expect(row?.name).toBe('Integración de prueba');
	expect(row?.start).toBe(key.slice(0, 11));

	// Cerrar el aviso: la clave sale del DOM, también tras recargar. Lo único
	// que queda es la fila del listado, con nombre y prefijo (start), nunca la
	// clave entera, y la última utilización a cero.
	await page.getByRole('link', { name: 'Ya lo he guardado' }).click();
	await expect(page.getByText(key)).toHaveCount(0);
	await page.reload();
	await expect(page.getByText(key)).toHaveCount(0);

	const listRow = page.locator('section ol > li', { hasText: 'Integración de prueba' });
	await expect(listRow).toBeVisible();
	await expect(listRow).toContainText(key.slice(0, 11));
	await expect(listRow).not.toContainText(key);
	await expect(listRow).toContainText('Nunca usado');
	await expect(listRow).toContainText('Creado');
});

test('el formulario exige nombre y respeta el límite del plugin (32 caracteres)', async ({
	page
}) => {
	const user = await createUser();
	await seedSession(page, user);

	await page.goto('/settings/api-tokens');
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Crear token' }).first().click();
	const dialog = page.locator('dialog[open]');

	// Vacío: el `required` nativo del input (lo pone FormFields) corta el envío
	// antes de superforms; el modal sigue abierto y no aparece ninguna clave.
	const nameInput = dialog.locator('input[name="name"]');
	await dialog.getByRole('button', { name: 'Crear token' }).click();
	await expect(nameInput).toHaveJSProperty('validity.valueMissing', true);
	await expect(dialog).toBeVisible();
	await expect(page.getByRole('status')).toHaveCount(0);

	// Más largo que el máximo del plugin: mismo mensaje, nada creado.
	await nameInput.fill('x'.repeat(33));
	await dialog.getByRole('button', { name: 'Crear token' }).click();
	await expect(dialog.getByText('El nombre debe tener entre 1 y 32 caracteres.')).toBeVisible();
	await expect(prisma.apikey.findFirst()).resolves.toBeNull();
});

test('revocar pide confirmación y el token desaparece de la lista y de la base', async ({
	page
}) => {
	const user = await createUser();
	await seedSession(page, user);

	// El alta va por UI (el flujo completo lo cubre el spec de crear): así la
	// fila llega al listado y hay un token que revocar.
	await page.goto('/settings/api-tokens');
	await waitForHydration(page);
	await page.getByRole('button', { name: 'Crear token' }).first().click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="name"]').fill('Para revocar');
	await dialog.getByRole('button', { name: 'Crear token' }).click();
	await expect(page.getByRole('status')).toBeVisible();
	await page.getByRole('link', { name: 'Ya lo he guardado' }).click();

	const row = page.locator('section ol > li', { hasText: 'Para revocar' });
	await expect(row).toBeVisible();

	// Primero la confirmación: escapar deja el token en su sitio.
	await row.getByRole('button', { name: 'Revocar token' }).click();
	const confirmDialog = page.locator('dialog[open]');
	await expect(confirmDialog.getByText('¿Revocar «Para revocar»?')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(confirmDialog).toHaveCount(0);
	await expect(row).toBeVisible();

	// Confirmar revoca: fuera de la vista y de la base, con el aviso de éxito.
	await row.getByRole('button', { name: 'Revocar token' }).click();
	await page
		.locator('dialog[open]')
		.getByRole('button', { name: 'Revocar definitivamente' })
		.click();
	await expect(page.getByRole('status')).toContainText('Token revocado');
	await expect(row).toHaveCount(0);
	await expect(prisma.apikey.findFirst({ where: { referenceId: user.id } })).resolves.toBeNull();
});
