import { expect, test } from '@playwright/test';
import { seedSession, waitForHydration } from '../../../../e2e/helpers/auth';
import { prisma } from '../../../../e2e/helpers/db';
import { addFamilyMember, createFamily, createUser, resetDb } from '../../../../e2e/helpers/seed';

test.beforeEach(async () => {
	await resetDb();
});

test('una familia ajena o inexistente redirige al listado', async ({ page }) => {
	const user = await createUser();
	await seedSession(page, user);

	// Inexistente…
	await page.goto('/families/no-existe');
	await expect(page).toHaveURL(/\/families$/);
	await expect(page.getByRole('heading', { name: 'Tus familias' })).toBeVisible();

	// …y existente pero ajena: de vuelta al listado, que ni siquiera la lista
	// (no es miembro: el listado se filtra por pertenencia).
	const admin = await createUser();
	const ajena = await createFamily({ name: 'Familia Ajena', owner: admin });
	await page.goto(`/families/${ajena.id}`);
	await expect(page).toHaveURL(/\/families$/);
	await expect(page.getByText('Familia Ajena')).toHaveCount(0);
});

test('muestra los miembros con su rol y marca al de la sesion', async ({ page }) => {
	const admin = await createUser({ name: 'Papá', email: 'papa@example.com' });
	const member = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	await addFamilyMember({ familyId: family.id, user: member });
	await seedSession(page, admin);

	await page.goto(`/families/${family.id}`);
	await waitForHydration(page);

	await expect(page.getByRole('heading', { name: 'Miembros de «Familia Pérez»' })).toBeVisible();

	const filaAdmin = page.locator('li', { hasText: 'papa@example.com' });
	await expect(filaAdmin.getByText('Administrador')).toBeVisible();
	await expect(filaAdmin.getByText('tú')).toBeVisible();

	const filaMiembro = page.locator('li', { hasText: 'maria@example.com' });
	await expect(filaMiembro.getByText('Miembro', { exact: true })).toBeVisible();
	// Admin sobre otros miembros: promover y expulsar.
	await expect(filaMiembro.getByRole('button', { name: 'Hacer admin' })).toBeVisible();
	await expect(filaMiembro.getByRole('button', { name: 'Expulsar' })).toBeVisible();
	// El admin no se promueve ni se expulsa a sí mismo.
	await expect(filaAdmin.getByRole('button', { name: 'Hacer admin' })).toHaveCount(0);
	await expect(filaAdmin.getByRole('button', { name: 'Expulsar' })).toHaveCount(0);
});

test('un miembro corriente no ve acciones de administracion', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const member = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	await addFamilyMember({ familyId: family.id, user: member });
	await seedSession(page, member);

	await page.goto(`/families/${family.id}`);
	await waitForHydration(page);

	await expect(page.getByRole('button', { name: 'Hacer admin' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Expulsar' })).toHaveCount(0);
	await expect(page.getByText('Zona de peligro')).toHaveCount(0);
	// Pero sí puede irse él, y se ve a sí mismo como «tú».
	await expect(page.getByRole('button', { name: 'Salir de la familia' })).toBeVisible();
	await expect(page.locator('li', { hasText: 'maria@example.com' }).getByText('tú')).toBeVisible();
});

test('promover a admin: el badge cambia en la vista y en la BD', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const member = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const membership = await addFamilyMember({ familyId: family.id, user: member });
	await seedSession(page, admin);

	await page.goto(`/families/${family.id}`);
	await waitForHydration(page);

	await page
		.locator('li', { hasText: 'maria@example.com' })
		.getByRole('button', { name: 'Hacer admin' })
		.click();

	const fila = page.locator('li', { hasText: 'maria@example.com' });
	await expect(fila.getByText('Administrador')).toBeVisible();

	const updated = await prisma.member.findUniqueOrThrow({ where: { id: membership.id } });
	const role = await prisma.role.findUniqueOrThrow({ where: { id: updated.roleId ?? '' } });
	expect(role.name).toBe('admin');
});

test('expulsar a un miembro con confirmacion', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const member = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const membership = await addFamilyMember({ familyId: family.id, user: member });
	await seedSession(page, admin);

	await page.goto(`/families/${family.id}`);
	await waitForHydration(page);

	await page
		.locator('li', { hasText: 'maria@example.com' })
		.getByRole('button', { name: 'Expulsar' })
		.click();
	const dialog = page.locator('dialog[open]');
	await expect(
		dialog.getByRole('heading', { name: '¿Expulsar a María de la familia?' })
	).toBeVisible();
	await dialog.getByRole('button', { name: 'Expulsar' }).click();

	// El éxito cierra el modal y el load revalidado ya no trae al miembro.
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.locator('li', { hasText: 'maria@example.com' })).toHaveCount(0);
	await expect(prisma.member.findUnique({ where: { id: membership.id } })).resolves.toBeNull();
});

test('el ultimo admin no puede salir y el error se queda en el modal', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	await seedSession(page, admin);

	await page.goto(`/families/${family.id}`);
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Salir de la familia' }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog.getByRole('heading', { name: '¿Salir de «Familia Pérez»?' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Salir' }).click();

	await expect(
		dialog.getByText(
			'Eres el último administrador: haz admin a otro miembro antes de salir, o borra la familia.'
		)
	).toBeVisible();
	// Sigue en la familia (el modal abierto es la prueba de que no hubo éxito).
	await expect(dialog).toBeVisible();
});

test('abandonar la familia redirige al listado y quita la membresia', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const member = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	const membership = await addFamilyMember({ familyId: family.id, user: member });
	await seedSession(page, member);

	await page.goto(`/families/${family.id}`);
	await waitForHydration(page);

	await page.getByRole('button', { name: 'Salir de la familia' }).click();
	const dialog = page.locator('dialog[open]');
	await dialog.getByRole('button', { name: 'Salir' }).click();

	await expect(page).toHaveURL(/\/families$/);
	await expect(prisma.member.findUnique({ where: { id: membership.id } })).resolves.toBeNull();
});

test('borrar la familia desde la zona de peligro redirige y la elimina', async ({ page }) => {
	const admin = await createUser({ name: 'Papá' });
	const member = await createUser({ name: 'María', email: 'maria@example.com' });
	const family = await createFamily({ name: 'Familia Pérez', owner: admin });
	await addFamilyMember({ familyId: family.id, user: member });
	await seedSession(page, admin);

	await page.goto(`/families/${family.id}`);
	await waitForHydration(page);

	await page.getByRole('button', { name: '¿Borrar «Familia Pérez»?' }).click();
	const dialog = page.locator('dialog[open]');
	await dialog.getByRole('button', { name: 'Borrar definitivamente' }).click();

	await expect(page).toHaveURL(/\/families$/);
	await expect(prisma.organization.findUnique({ where: { id: family.id } })).resolves.toBeNull();
	// La cascada del plugin se lleva también a los miembros.
	const members = await prisma.member.count({ where: { contextId: family.id } });
	expect(members).toBe(0);
});
