import { expect, test } from '@playwright/test';
import { readOtp, seedSession, waitForHydration } from '../../../../e2e/helpers/auth';
import { prisma } from '../../../../e2e/helpers/db';
import { createFamily, createInvitation, createUser, resetDb } from '../../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('un token desconocido muestra la invitacion como invalida', async ({ page }) => {
	await page.goto('/invitations/no-existe');

	await expect(page.getByRole('heading', { name: 'Invitación a la familia' })).toBeVisible();
	await expect(page.getByText('Esta invitación no es válida o ha caducado.')).toBeVisible();
});

test('pendiente y sin sesion: al login con el email del invitado prefijado', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const invitation = await createInvitation({
		familyId: family.id,
		invitedBy: admin,
		email: 'maria@example.com'
	});

	await page.goto(`/invitations/${invitation.token}`);
	await expect(page).toHaveURL(
		/\/login\?redirectTo=%2Finvitations%2F.*&email=maria%40example\.com$/
	);

	// La página de login avisa del contexto y no pide teclear el email.
	await expect(
		page.getByText('Tienes una invitación para este email (maria@example.com)')
	).toBeVisible();
	await expect(page.locator('input[name="email"]')).toHaveValue('maria@example.com');
});

test('caducada se lee sin sesion y sin mandar al login', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const invitation = await createInvitation({
		familyId: family.id,
		invitedBy: admin,
		email: 'maria@example.com',
		expiresAt: new Date(Date.now() - 60 * 1000)
	});

	await page.goto(`/invitations/${invitation.token}`);
	await expect(page).toHaveURL(new RegExp(`/invitations/${invitation.token}$`));
	await expect(page.getByText('Caducada')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Aceptar invitación' })).toHaveCount(0);
});

test('aceptada se muestra su estado a quien llegue con el enlace', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const invitation = await createInvitation({
		familyId: family.id,
		invitedBy: admin,
		email: 'maria@example.com',
		status: 'accepted'
	});

	await page.goto(`/invitations/${invitation.token}`);
	await expect(page.getByText('Aceptada')).toBeVisible();
});

test('aceptar con la sesion del invitado: alta en la familia y al selector', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const invited = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const invitation = await createInvitation({
		familyId: family.id,
		invitedBy: admin,
		email: invited.email
	});
	await seedSession(page, invited);

	await page.goto(`/invitations/${invitation.token}`);
	await waitForHydration(page);

	await expect(page.getByText('Papá te invita a su familia')).toBeVisible();
	await expect(page.getByText('Familia Pérez')).toBeVisible();
	await page.getByRole('button', { name: 'Aceptar invitación' }).click();

	// Criterio de la issue: de vuelta en /families, la familia ya es suya.
	await expect(page).toHaveURL(/\/families$/);
	await expect(page.getByRole('link', { name: 'Familia Pérez' })).toBeVisible();

	const stored = await prisma.invitation.findUniqueOrThrow({ where: { token: invitation.token } });
	expect(stored.status).toBe('accepted');
	const members = await prisma.member.findMany({ where: { contextId: family.id } });
	expect(members.map((member) => member.userId)).toContain(invited.id);
});

test('un doble toque en «Aceptar» envía un solo POST (#115)', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const invited = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const invitation = await createInvitation({
		familyId: family.id,
		invitedBy: admin,
		email: invited.email
	});
	await seedSession(page, invited);

	// La respuesta se retiene: el 2.º toque llega con la 1.ª petición en vuelo.
	let posts = 0;
	await page.route('**/invitations/*?/accept', async (route) => {
		posts++;
		await new Promise((resolve) => setTimeout(resolve, 500));
		await route.continue();
	});

	await page.goto(`/invitations/${invitation.token}`);
	await waitForHydration(page);
	await page.getByRole('button', { name: 'Aceptar invitación' }).click({ clickCount: 2 });

	await expect(page).toHaveURL(/\/families$/);
	await expect(page.getByRole('link', { name: 'Familia Pérez' })).toBeVisible();
	expect(posts).toBe(1);
});

test('rechazar: estado rechazada, sin alta en la familia', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const invited = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const invitation = await createInvitation({
		familyId: family.id,
		invitedBy: admin,
		email: invited.email
	});
	await seedSession(page, invited);

	await page.goto(`/invitations/${invitation.token}`);
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Rechazar' }).click();

	// La página recargada muestra la invitación en su estado nuevo.
	await expect(page).toHaveURL(new RegExp(`/invitations/${invitation.token}$`));
	await expect(page.getByText('Rechazada')).toBeVisible();

	const stored = await prisma.invitation.findUniqueOrThrow({ where: { token: invitation.token } });
	expect(stored.status).toBe('rejected');
	expect(await prisma.member.count({ where: { contextId: family.id } })).toBe(1); // solo el admin
});

test('la sesion de otro email ve el aviso y no tiene botones', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const other = await createUser({ name: 'Otro', email: 'otro@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const invitation = await createInvitation({
		familyId: family.id,
		invitedBy: admin,
		email: 'maria@example.com'
	});
	await seedSession(page, other);

	await page.goto(`/invitations/${invitation.token}`);
	await waitForHydration(page);

	await expect(page.getByText('Esta invitación está a nombre de otro email')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Aceptar invitación' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Rechazar' })).toHaveCount(0);
});

test('flujo completo del enlace: login con email prefijado, volver y aceptar', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const invited = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const invitation = await createInvitation({
		familyId: family.id,
		invitedBy: admin,
		email: invited.email
	});

	// El enlace del correo, sin sesión: login con el email ya relleno.
	await page.goto(`/invitations/${invitation.token}`);
	await expect(page).toHaveURL(
		/\/login\?redirectTo=%2Finvitations%2F.*&email=maria%40example\.com$/
	);
	await expect(page.locator('input[name="email"]')).toHaveValue('maria@example.com');
	await waitForHydration(page);
	await page.getByRole('button', { name: 'Iniciar sesión' }).click();

	// El OTP viaja en la BD (en dev no hay SMTP): se teclea y la app vuelve
	// sola a la invitación (`redirectTo`).
	const otpInput = page.locator('input[autocomplete="one-time-code"]');
	await otpInput.waitFor();
	await otpInput.pressSequentially(await readOtp(invited.email));

	await page.waitForURL(new RegExp(`/invitations/${invitation.token}$`));
	await page.getByRole('button', { name: 'Aceptar invitación' }).click();

	await expect(page).toHaveURL(/\/families$/);
	await expect(page.getByRole('link', { name: 'Familia Pérez' })).toBeVisible();
});
