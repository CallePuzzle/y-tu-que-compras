import { describe, expect, it } from 'vitest';
import type { GenericEndpointContext } from '@better-auth/core';
import type { EntityCreatedEvent } from '@zytera/better-auth-tenancy';

import {
	FAMILY_ADMIN_ROLE,
	FAMILY_ADMIN_STATEMENTS,
	FAMILY_MEMBER_ROLE,
	FAMILY_MEMBER_STATEMENTS,
	seedFamilyRoles,
	tenancyConfig
} from './tenancy.js';

/** `AuthContext['adapter']`, deducido del propio seed para el cast del mock. */
type Adapter = Parameters<typeof seedFamilyRoles>[0];

/**
 * Mock del adaptador de better-auth: registra los `create` y devuelve ids
 * secuenciales; `findMany` responde con las pertenencias fijadas.
 */
function adapterMock(memberships: { contextId: string }[] = []) {
	const created: { model: string; data: Record<string, unknown> }[] = [];
	return {
		created,
		// Como el adaptador real: el registro devuelto (y guardado) lleva el id
		// generado, aunque no viniera en `data`.
		async create<T>({ model, data }: { model: string; data: Record<string, unknown> }) {
			const record = { id: `id-${created.length + 1}`, ...data };
			created.push({ model, data: record });
			return record as T;
		},
		async findMany() {
			return memberships;
		}
	};
}

/** Contexto de endpoint con el adaptador (y sesión) pasados. */
function ctxOf(adapter: unknown, session?: unknown): GenericEndpointContext {
	return { context: { adapter, session: session ?? null } } as unknown as GenericEndpointContext;
}

function eventOf(entityType: 'organization' | 'team', entityId = 'fam-1'): EntityCreatedEvent {
	return { entityType, entityId, createdBy: 'user-1', timestamp: new Date() };
}

describe('seedFamilyRoles', () => {
	it('siembra los roles admin y member de la familia y devuelve el id del admin', async () => {
		const adapter = adapterMock();
		const adminRoleId = await seedFamilyRoles(adapter as unknown as Adapter, 'fam-1');

		const roles = adapter.created.filter(({ model }) => model === 'role');
		expect(roles).toHaveLength(2);
		expect(roles.map(({ data }) => data.name)).toEqual([FAMILY_ADMIN_ROLE, FAMILY_MEMBER_ROLE]);
		// Todos colgados de la familia, como organization.
		expect(roles.map(({ data }) => data.contextId)).toEqual(['fam-1', 'fam-1']);
		expect(roles.map(({ data }) => data.contextType)).toEqual(['organization', 'organization']);
		expect(adminRoleId).toBe(roles.find(({ data }) => data.name === FAMILY_ADMIN_ROLE)?.data.id);
	});

	it('cuelga del admin sus statements y del member los suyos', async () => {
		const adapter = adapterMock();
		await seedFamilyRoles(adapter as unknown as Adapter, 'fam-1');

		const roleIdOf = (roleName: string) =>
			adapter.created.find(({ model, data }) => model === 'role' && data.name === roleName)?.data
				.id;
		const statementsOf = (roleId: unknown) =>
			adapter.created
				.filter(({ model, data }) => model === 'roleStatement' && data.roleId === roleId)
				.map(({ data }) => data.statementId);

		expect(statementsOf(roleIdOf(FAMILY_ADMIN_ROLE))).toEqual([...FAMILY_ADMIN_STATEMENTS]);
		expect(statementsOf(roleIdOf(FAMILY_MEMBER_ROLE))).toEqual([...FAMILY_MEMBER_STATEMENTS]);
	});

	it('traduce los nombres de rol a es y en', async () => {
		const adapter = adapterMock();
		await seedFamilyRoles(adapter as unknown as Adapter, 'fam-1');

		const translations = adapter.created.filter(({ model }) => model === 'roleTranslation');
		expect(translations).toHaveLength(4);

		const roleIdOf = (roleName: string) =>
			adapter.created.find(({ model, data }) => model === 'role' && data.name === roleName)?.data
				.id;
		const nameOf = (roleId: unknown, locale: string) =>
			translations.find(({ data }) => data.roleId === roleId && data.locale === locale)?.data.name;

		expect(nameOf(roleIdOf(FAMILY_ADMIN_ROLE), 'es')).toBe('Administrador');
		expect(nameOf(roleIdOf(FAMILY_ADMIN_ROLE), 'en')).toBe('Admin');
		expect(nameOf(roleIdOf(FAMILY_MEMBER_ROLE), 'es')).toBe('Miembro');
		expect(nameOf(roleIdOf(FAMILY_MEMBER_ROLE), 'en')).toBe('Member');
	});
});

describe('tenancyConfig.actions.onEntityCreated', () => {
	it('siembra los roles y da de alta al creador como miembro admin', async () => {
		const adapter = adapterMock();
		await tenancyConfig.actions?.onEntityCreated?.(eventOf('organization'), ctxOf(adapter));

		expect(adapter.created.some(({ model }) => model === 'role')).toBe(true);

		// El plugin no añade al creador como miembro: lo hace este hook, con el
		// rol admin sembrado.
		const members = adapter.created.filter(({ model }) => model === 'member');
		expect(members).toHaveLength(1);
		expect(members[0].data.userId).toBe('user-1');
		expect(members[0].data.contextType).toBe('organization');
		expect(members[0].data.contextId).toBe('fam-1');
		const adminRole = adapter.created.find(
			({ model, data }) => model === 'role' && data.name === FAMILY_ADMIN_ROLE
		);
		expect(members[0].data.roleId).toBe(adminRole?.data.id);
	});

	it('no siembra nada para teams (una familia no tiene subgrupos)', async () => {
		const adapter = adapterMock();
		await tenancyConfig.actions?.onEntityCreated?.(eventOf('team'), ctxOf(adapter));

		expect(adapter.created).toHaveLength(0);
	});
});

describe('tenancyConfig.permissionFiltering.filterOrganizations', () => {
	it('devuelve solo las familias donde el usuario es miembro', async () => {
		const adapter = adapterMock([{ contextId: 'fam-1' }, { contextId: 'fam-3' }]);
		const organizations = [{ id: 'fam-1' }, { id: 'fam-2' }, { id: 'fam-3' }];

		const filtered = await tenancyConfig.permissionFiltering?.filterOrganizations?.(
			ctxOf(adapter, { user: { id: 'user-1' } }),
			organizations
		);

		expect(filtered).toEqual([{ id: 'fam-1' }, { id: 'fam-3' }]);
	});

	it('sin sesión no devuelve ninguna', async () => {
		const adapter = adapterMock();
		const organizations = [{ id: 'fam-1' }];

		const filtered = await tenancyConfig.permissionFiltering?.filterOrganizations?.(
			ctxOf(adapter),
			organizations
		);

		expect(filtered).toEqual([]);
	});

	it('con sesión pero sin pertenencias no devuelve ninguna', async () => {
		const adapter = adapterMock([]);
		const organizations = [{ id: 'fam-1' }];

		const filtered = await tenancyConfig.permissionFiltering?.filterOrganizations?.(
			ctxOf(adapter, { user: { id: 'user-1' } }),
			organizations
		);

		expect(filtered).toEqual([]);
	});
});

describe('tenancyConfig.i18n', () => {
	it('el español es la locale por defecto de los mensajes del plugin', () => {
		expect(tenancyConfig.i18n?.defaultLocale).toBe('es');
	});
});
