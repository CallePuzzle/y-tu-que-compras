import { expect, test } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../e2e/helpers/auth';
import { prisma } from '../../../e2e/helpers/db';
import { addFamilyMember, createFamily, createUser, resetDb } from '../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('sin familias muestra el estado vacio', async ({ page }) => {
	const user = await createUser();
	await seedSession(page, user);

	await page.goto('/families');
	await waitForHydration(page);

	await expect(page.getByRole('heading', { name: 'Tus familias' })).toBeVisible();
	await expect(page.getByText(/Todavía no perteneces a ninguna familia/)).toBeVisible();
	// El selector de familia de la cabecera, sin familias, manda a crear.
	await expect(page.getByRole('link', { name: 'Crear familia' }).first()).toBeVisible();
});

test('crear familia por UI: aviso de exito, aparece en la lista y el creador es admin', async ({
	page
}) => {
	const user = await createUser({ name: 'Papá' });
	await seedSession(page, user);

	await page.goto('/families');
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Crear familia' }).first().click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="name"]').fill('Familia Pérez');
	await dialog.getByRole('button', { name: 'Crear familia' }).click();

	// El aviso de éxito vive FUERA del modal (role=status); el $message del
	// formulario se queda en el modal ya cerrado, así que no se busca a ciegas.
	await expect(page.getByRole('status')).toContainText('Familia creada: ya aparece en tu lista.');
	await expect(page.getByRole('link', { name: 'Familia Pérez' })).toBeVisible();

	// El seed de roles y el alta del creador como admin son trabajo del plugin
	// (hooks `onEntityCreated`): la UI lo evidencia con el botón de invitar.
	const family = await prisma.organization.findFirstOrThrow({ where: { name: 'Familia Pérez' } });
	const membership = await prisma.member.findFirstOrThrow({
		where: { contextId: family.id, userId: user.id },
		include: { role: true }
	});
	expect(membership.role?.name).toBe('admin');
});

test('solo el admin ve el boton de invitar', async ({ page }) => {
	const admin = await createUser({ name: 'Admin' });
	const member = await createUser({ name: 'Miembro' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	await addFamilyMember({ familyId: family.id, user: member });

	await seedSession(page, member);
	await page.goto('/families');
	await waitForHydration(page);

	const row = page.locator('li', { hasText: 'Familia Pérez' });
	await expect(row.getByRole('link', { name: 'Miembros' })).toBeVisible();
	// (Que el admin SÍ lo ve lo cubren los tests de invitar más abajo.)
	await expect(row.getByRole('button', { name: 'Invitar' })).toHaveCount(0);
});

test('invitar por email: exito e invitacion pendiente en la BD', async ({ page }) => {
	const admin = await createUser({ name: 'Admin' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	await seedSession(page, admin);

	await page.goto('/families');
	await waitForHydration(page);

	await page
		.locator('li', { hasText: 'Familia Pérez' })
		.getByRole('button', { name: 'Invitar' })
		.click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: 'Invitar a «Familia Pérez»' })).toBeVisible();

	await dialog.locator('input[name="email"]').fill('maria@example.com');
	await dialog.getByRole('button', { name: 'Invitar' }).click();

	await expect(page.getByRole('status')).toContainText(
		'Invitación enviada: maria@example.com recibirá un correo.'
	);

	const invitation = await prisma.invitation.findFirstOrThrow({
		where: { contextId: family.id }
	});
	expect(invitation.identifier).toBe('maria@example.com');
	expect(invitation.status).toBe('pending');
});

test('invitar a quien ya es miembro da un error concreto y el modal sigue abierto', async ({
	page
}) => {
	const admin = await createUser({ name: 'Admin' });
	const member = await createUser({ name: 'Miembro', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	await addFamilyMember({ familyId: family.id, user: member });
	await seedSession(page, admin);

	await page.goto('/families');
	await waitForHydration(page);

	await page
		.locator('li', { hasText: 'Familia Pérez' })
		.getByRole('button', { name: 'Invitar' })
		.click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="email"]').fill(member.email);
	await dialog.getByRole('button', { name: 'Invitar' }).click();

	await expect(dialog.getByText('maria@example.com ya es miembro de la familia.')).toBeVisible();
	// El fallo se queda dentro del modal: sigue abierto para corregir.
	await expect(dialog).toBeVisible();
});

test('reinvitar con invitacion pendiente da un error concreto', async ({ page }) => {
	const admin = await createUser({ name: 'Admin' });
	await createFamily({ name: 'Familia Pérez', owner: admin });
	await seedSession(page, admin);

	await page.goto('/families');
	await waitForHydration(page);

	const invitar = page.locator('li', { hasText: 'Familia Pérez' }).getByRole('button', {
		name: 'Invitar'
	});
	await invitar.click();
	const dialog = page.locator('dialog[open]');
	await dialog.locator('input[name="email"]').fill('maria@example.com');
	await dialog.getByRole('button', { name: 'Invitar' }).click();
	await expect(page.getByRole('status')).toContainText(/Invitación enviada/);

	await invitar.click();
	const dialogReabrir = page.locator('dialog[open]');
	await dialogReabrir.locator('input[name="email"]').fill('maria@example.com');
	await dialogReabrir.getByRole('button', { name: 'Invitar' }).click();

	await expect(
		dialogReabrir.getByText('maria@example.com ya tiene una invitación pendiente.')
	).toBeVisible();
});
