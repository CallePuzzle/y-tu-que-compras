import { randomUUID } from 'node:crypto';
import { prisma } from './db';

import type {
	Invitation,
	Item,
	List,
	Member,
	Organization,
	PantryItem,
	PurchaseRecord,
	Unit,
	User
} from '../../src/lib/generated/prisma/client';

// ============================================================================
// Semillas de la BD de test. Las familias se siembran IGUAL que las siembra la
// app al crearlas vía el plugin (`onEntityCreated` + `seedFamilyRoles` de
// `$lib/server/tenancy.ts`): organización, roles admin/member con sus
// statements y traducciones, y el creador como miembro admin. Los valores van
// duplicados aquí a propósito: importar `tenancy.ts` arrastraría la cadena de
// imports del servidor (`$env/dynamic/private` incluido), que no resuelve
// fuera de Vite.
// ============================================================================

const FAMILY_ADMIN_STATEMENTS = [
	'organization:update',
	'organization:delete',
	'member:invite',
	'member:remove',
	'member:update',
	'invitation:cancel'
] as const;

const FAMILY_MEMBER_STATEMENTS = ['organization:get'] as const;

const FAMILY_ROLE_TRANSLATIONS: Record<string, Record<string, string>> = {
	admin: { es: 'Administrador', en: 'Admin' },
	member: { es: 'Miembro', en: 'Member' }
};

// Deja la BD de test vacía entre tests. TRUNCATE ... CASCADE resuelve las
// referencias cruzadas (member→user/role, list→organization, item→list,
// pantryItem→organization, purchaseRecord→organization…).
export async function resetDb(): Promise<void> {
	await prisma.$executeRaw`TRUNCATE TABLE "user", "session", "account", "verification", "rateLimit", "organization", "team", "role", "roleStatement", "roleTranslation", "statement", "statementTranslation", "member", "permissionGrant", "permissionDeny", "invitation", "list", "item", "pantryItem", "purchaseRecord", "purchaseItem" RESTART IDENTITY CASCADE`;
}

export async function createUser(options: { email?: string; name?: string } = {}): Promise<User> {
	const suffix = randomUUID().slice(0, 8);
	const now = new Date();
	return prisma.user.create({
		data: {
			id: randomUUID(),
			name: options.name ?? `Usuario E2E ${suffix}`,
			email: options.email ?? `user-${suffix}@e2e.test`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		}
	});
}

/** Un rol de familia con sus statements y traducciones (ver `createFamilyRole` de tenancy.ts). */
async function createFamilyRole(
	familyId: string,
	roleName: string,
	statements: readonly string[]
): Promise<{ id: string }> {
	const now = new Date();
	const role = await prisma.role.create({
		data: {
			id: randomUUID(),
			contextType: 'organization',
			contextId: familyId,
			name: roleName,
			createdAt: now,
			updatedAt: now
		}
	});

	for (const statementId of statements) {
		await prisma.roleStatement.create({
			data: { id: randomUUID(), roleId: role.id, statementId, createdAt: now }
		});
	}

	for (const [locale, name] of Object.entries(FAMILY_ROLE_TRANSLATIONS[roleName])) {
		await prisma.roleTranslation.create({
			data: { id: randomUUID(), roleId: role.id, locale, name, createdAt: now }
		});
	}

	return role;
}

/** Roles admin y member de una familia, por nombre. */
async function seedFamilyRoles(familyId: string): Promise<{ admin: string; member: string }> {
	const admin = await createFamilyRole(familyId, 'admin', FAMILY_ADMIN_STATEMENTS);
	const member = await createFamilyRole(familyId, 'member', FAMILY_MEMBER_STATEMENTS);
	return { admin: admin.id, member: member.id };
}

/**
 * Crea una familia con sus roles sembrados y `owner` como miembro admin: el
 * mismo estado que deja «Crear familia» pasando por el plugin, sin depender de
 * la UI ni de la sesión.
 */
export async function createFamily(options: { name?: string; owner: User }): Promise<Organization> {
	const name = options.name ?? `Familia E2E ${randomUUID().slice(0, 8)}`;
	const now = new Date();
	const family = await prisma.organization.create({
		data: {
			id: randomUUID(),
			name,
			// Formato del plugin: minúsculas, guiones, único (sufijo aleatorio).
			slug: `familia-${randomUUID().replaceAll('-', '').slice(0, 6)}`,
			createdAt: now,
			updatedAt: now
		}
	});

	const roles = await seedFamilyRoles(family.id);
	await addFamilyMember({ familyId: family.id, user: options.owner, role: 'admin', roles });

	return family;
}

/** Añade un miembro a la familia (rol `member` por defecto). */
export async function addFamilyMember(options: {
	familyId: string;
	user: User;
	role?: 'admin' | 'member';
	/** Ids de rol ya sembrados (los pasa `createFamily` para no reconsultar). */
	roles?: { admin: string; member: string };
}): Promise<Member> {
	let roles = options.roles;
	if (!roles) {
		const rows = await prisma.role.findMany({
			where: { contextType: 'organization', contextId: options.familyId },
			select: { name: true, id: true }
		});
		roles = {
			admin: rows.find((row) => row.name === 'admin')?.id ?? '',
			member: rows.find((row) => row.name === 'member')?.id ?? ''
		};
	}

	const now = new Date();
	return prisma.member.create({
		data: {
			id: randomUUID(),
			contextType: 'organization',
			contextId: options.familyId,
			userId: options.user.id,
			roleId: options.role === 'admin' ? roles.admin : roles.member,
			createdAt: now,
			updatedAt: now
		}
	});
}

/** Una lista de la compra de la familia (colores/iconos válidos de la #66). */
export async function createList(options: {
	familyId: string;
	name?: string;
	color?: string;
	icon?: string;
}): Promise<List> {
	const now = new Date();
	return prisma.list.create({
		data: {
			organizationId: options.familyId,
			name: options.name ?? `Lista E2E ${randomUUID().slice(0, 8)}`,
			color: options.color ?? 'primary',
			icon: options.icon ?? 'shopping-basket',
			createdAt: now,
			updatedAt: now
		}
	});
}

/** Un item de una lista (issue #67): nombre, cantidad, unidad y estado. */
export async function createItem(options: {
	listId: string;
	name?: string;
	quantity?: number;
	unit?: Unit;
	purchased?: boolean;
	/** Posición en la lista: el servidor la calcula al crear; aquí explícita. */
	order?: number;
}): Promise<Item> {
	const now = new Date();
	return prisma.item.create({
		data: {
			listId: options.listId,
			name: options.name ?? `Item E2E ${randomUUID().slice(0, 8)}`,
			quantity: options.quantity ?? 1,
			unit: options.unit ?? 'unit',
			purchased: options.purchased ?? false,
			order: options.order ?? 0,
			createdAt: now,
			updatedAt: now
		}
	});
}

/**
 * Un producto de la despensa (issue #70): lo mismo que deja `finalizePurchase`
 * al cerrar una compra — nombre visible (el de la primera compra), su canónico
 * y la cantidad acumulada.
 */
export async function createPantryItem(options: {
	familyId: string;
	name?: string;
	normalizedName?: string;
	quantity?: number;
	unit?: Unit;
}): Promise<PantryItem> {
	const now = new Date();
	const name = options.name ?? `Producto E2E ${randomUUID().slice(0, 8)}`;
	return prisma.pantryItem.create({
		data: {
			organizationId: options.familyId,
			name,
			normalizedName: options.normalizedName ?? name.trim().toLowerCase(),
			quantity: options.quantity ?? 1,
			unit: options.unit ?? 'unit',
			createdAt: now,
			updatedAt: now
		}
	});
}

/**
 * Una compra finalizada (issues #70 y #75): el snapshot que deja
 * `finalizePurchase` — lista de origen (nombre guardado, `listId` opcional
 * para ejercitar listas borradas), total a mano, fecha explícita para poder
 * ordenar el historial y los items congelados del momento.
 */
export async function createPurchaseRecord(options: {
	familyId: string;
	listName?: string;
	listId?: string | null;
	total?: number;
	userId?: string | null;
	createdAt?: Date;
	items?: Array<{ name?: string; quantity?: number; unit?: Unit }>;
}): Promise<PurchaseRecord> {
	const listName = options.listName ?? `Lista E2E ${randomUUID().slice(0, 8)}`;
	const items = options.items ?? [{}];
	return prisma.purchaseRecord.create({
		data: {
			organizationId: options.familyId,
			listId: options.listId ?? null,
			listName,
			total: options.total ?? 0,
			userId: options.userId ?? null,
			createdAt: options.createdAt ?? new Date(),
			items: {
				create: items.map((item, position) => ({
					position,
					name: item.name ?? `Producto E2E ${randomUUID().slice(0, 8)}`,
					quantity: item.quantity ?? 1,
					unit: item.unit ?? 'unit'
				}))
			}
		}
	});
}

/**
 * Una invitación a la familia (issue #60), igual que la deja `inviteFamily`:
 * identifier en minúsculas, rol de entrada `member`, estado `pending` y
 * caducidad a una semana. Sin correo: el envío es cosa del hook del plugin y
 * en los e2e no hay SMTP.
 */
export async function createInvitation(options: {
	familyId: string;
	invitedBy: User;
	email: string;
	status?: string;
	expiresAt?: Date;
}): Promise<Invitation> {
	const memberRole = await prisma.role.findFirst({
		where: { contextType: 'organization', contextId: options.familyId, name: 'member' },
		select: { id: true }
	});

	const now = new Date();
	return prisma.invitation.create({
		data: {
			id: randomUUID(),
			token: randomUUID(),
			identifier: options.email.trim().toLowerCase(),
			contextType: 'organization',
			contextId: options.familyId,
			roleId: memberRole?.id,
			invitedBy: options.invitedBy.id,
			status: options.status ?? 'pending',
			expiresAt: options.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
			createdAt: now
		}
	});
}
