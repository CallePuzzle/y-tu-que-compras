import { afterEach, describe, expect, it } from 'vitest';
import type { GenericEndpointContext } from '@better-auth/core';
import type { EntityCreatedEvent } from '@zytera/better-auth-tenancy';
import { tenancy } from '@zytera/better-auth-tenancy/server';
import type { EndpointAuthHook } from '@zytera/better-auth-tenancy/server';

import {
	ALREADY_FAMILY_MEMBER_MESSAGE,
	FAMILY_ADMIN_ROLE,
	FAMILY_ADMIN_STATEMENTS,
	FAMILY_MEMBER_ROLE,
	FAMILY_MEMBER_STATEMENTS,
	FAMILY_MEMBERS_LIMIT_MESSAGE,
	MAX_FAMILY_MEMBERS,
	MAX_FAMILIES_PER_USER,
	seedFamilyRoles,
	tenancyConfig
} from './tenancy.js';
import { capturedEmailsForTests, clearCapturedEmailsForTests } from './sender.js';

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

/**
 * Escenario canónico para las pruebas de autorización: la familia `fam-1`
 * (slug `fam-slug`) con los roles sembrados —`admin-1` con rol admin,
 * `member-1` con rol member y `outsider-1` sin pertenencia—. El mock responde
 * justo lo que `resolvePermission` consulta al evaluar un statement.
 */
function familyAdapterMock() {
	const roleIds = { admin: 'role-admin', member: 'role-member' } as const;
	const memberships: Record<string, string>[] = [
		{
			id: 'membership-admin',
			userId: 'admin-1',
			contextType: 'organization',
			contextId: 'fam-1',
			roleId: roleIds.admin
		},
		{
			id: 'membership-member',
			userId: 'member-1',
			contextType: 'organization',
			contextId: 'fam-1',
			roleId: roleIds.member
		}
	];
	const statementsByRole: Record<string, readonly string[]> = {
		[roleIds.admin]: FAMILY_ADMIN_STATEMENTS,
		[roleIds.member]: FAMILY_MEMBER_STATEMENTS
	};

	return {
		async findMany({
			model,
			where
		}: {
			model: string;
			where: { field: string; value: unknown }[];
		}) {
			// Sin concesiones ni denegaciones explícitas: el permiso sale del rol.
			if (model === 'permissionDeny' || model === 'permissionGrant') return [];
			if (model === 'member') {
				return memberships.filter((membership) =>
					where.every(({ field, value }) => membership[field] === value)
				);
			}
			if (model === 'roleStatement') {
				const roleId = where.find(({ field }) => field === 'roleId')?.value;
				return (statementsByRole[roleId as string] ?? []).map((statementId) => ({
					statementId
				}));
			}
			return [];
		},
		async findOne({ model, where }: { model: string; where: { field: string; value: unknown }[] }) {
			if (model === 'organization') {
				const slug = where.find(({ field }) => field === 'slug')?.value;
				return slug === 'fam-slug' ? { id: 'fam-1' } : null;
			}
			if (model === 'member') {
				const id = where.find(({ field }) => field === 'id')?.value;
				return memberships.find((membership) => membership.id === id) ?? null;
			}
			return null;
		}
	};
}

/** Sesión con el usuario que los hooks de autorización deben evaluar. */
function sessionOf(userId: string) {
	return { user: { id: userId } };
}

/** Pinta de request el `ctx` que el plugin le pasa a un hook de `endpoints`. */
function callHook(
	hook: EndpointAuthHook | undefined,
	adapter: unknown,
	request: {
		body?: Record<string, unknown>;
		query?: Record<string, unknown>;
		params?: Record<string, unknown>;
		resource?: Record<string, unknown>;
	},
	session?: unknown
): Promise<unknown> {
	if (!hook) {
		throw new Error('El endpoint no tiene hook de autorización cableado');
	}
	return hook({ ctx: { ...request, context: { adapter } }, session });
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

describe('tenancyConfig.endpoints (statements de admin)', () => {
	const familiaResource = { contextType: 'organization', contextId: 'fam-1' };

	// Cada operación de admin con el hook que la guarda y la petición tal y
	// como el plugin se la entregaría (body, o resource ya resuelto).
	const adminCases: {
		statement: string;
		hook: EndpointAuthHook | undefined;
		request: Parameters<typeof callHook>[2];
	}[] = [
		{
			statement: 'organization:update (renombrar)',
			hook: tenancyConfig.endpoints?.organization?.update,
			request: { body: { id: 'fam-1', name: 'Los Pérez' } }
		},
		{
			statement: 'organization:delete (borrar)',
			hook: tenancyConfig.endpoints?.organization?.delete,
			request: { body: { id: 'fam-1' } }
		},
		{
			statement: 'member:invite (añadir miembro)',
			hook: tenancyConfig.endpoints?.member?.add,
			request: { body: { userId: 'new-1', ...familiaResource } }
		},
		{
			statement: 'member:invite (crear invitación)',
			hook: tenancyConfig.endpoints?.invitation?.create,
			request: { body: { identifier: 'nueva@familia.es', ...familiaResource } }
		},
		{
			statement: 'member:remove (expulsar)',
			hook: tenancyConfig.endpoints?.member?.remove,
			request: { body: { id: 'member-9' }, resource: familiaResource }
		},
		{
			statement: 'member:update (cambiar rol)',
			hook: tenancyConfig.endpoints?.member?.updateRole,
			request: { body: { id: 'member-9', roleId: 'role-admin' }, resource: familiaResource }
		},
		{
			statement: 'invitation:cancel (cancelar invitación)',
			hook: tenancyConfig.endpoints?.invitation?.revoke,
			request: { body: { id: 'inv-1' }, resource: familiaResource }
		}
	];

	for (const { statement, hook, request } of adminCases) {
		it(`«${statement}» se le permite al admin de la familia`, async () => {
			await expect(
				callHook(hook, familyAdapterMock(), request, sessionOf('admin-1'))
			).resolves.toBeUndefined();
		});

		it(`«${statement}» se le niega a un miembro sin rol admin`, async () => {
			await expect(
				callHook(hook, familyAdapterMock(), request, sessionOf('member-1'))
			).rejects.toThrow(`Missing permission: ${statement.split(' ')[0]}`);
		});

		it(`«${statement}» se le niega a quien no pertenece a la familia`, async () => {
			await expect(
				callHook(hook, familyAdapterMock(), request, sessionOf('outsider-1'))
			).rejects.toThrow('Missing permission:');
		});
	}

	it('sin sesión, la administración pide autenticación', async () => {
		const { hook, request } = adminCases[0];
		await expect(callHook(hook, familyAdapterMock(), request)).rejects.toThrow(
			'Authentication required'
		);
	});
});

describe('tenancyConfig.endpoints (listados de miembros e invitaciones)', () => {
	const listMembers = tenancyConfig.endpoints?.member?.list;
	const listInvitations = tenancyConfig.endpoints?.invitation?.list;
	const query = { contextType: 'organization', contextId: 'fam-1' };

	it('un miembro lista los miembros de su familia', async () => {
		await expect(
			callHook(listMembers, familyAdapterMock(), { query }, sessionOf('member-1'))
		).resolves.toBeUndefined();
	});

	it('un miembro ve un miembro de su familia por id (member/:id)', async () => {
		await expect(
			callHook(
				listMembers,
				familyAdapterMock(),
				{ params: { id: 'membership-member' } },
				sessionOf('member-1')
			)
		).resolves.toBeUndefined();
	});

	it('quien no pertenece no lista miembros ajenos, ni por query ni por id', async () => {
		await expect(
			callHook(listMembers, familyAdapterMock(), { query }, sessionOf('outsider-1'))
		).rejects.toThrow('Missing permission: organization:get');
		await expect(
			callHook(
				listMembers,
				familyAdapterMock(),
				{ params: { id: 'membership-member' } },
				sessionOf('outsider-1')
			)
		).rejects.toThrow('Missing permission: organization:get');
	});

	it('un id de miembro inexistente se deniega sin revelar si existe', async () => {
		await expect(
			callHook(
				listMembers,
				familyAdapterMock(),
				{ params: { id: 'no-existe' } },
				sessionOf('member-1')
			)
		).rejects.toThrow('Missing permission: organization:get');
	});

	it('el admin lista las invitaciones de su familia', async () => {
		await expect(
			callHook(listInvitations, familyAdapterMock(), { query }, sessionOf('admin-1'))
		).resolves.toBeUndefined();
	});

	it('un miembro sin rol admin no lista invitaciones (llevan emails)', async () => {
		await expect(
			callHook(listInvitations, familyAdapterMock(), { query }, sessionOf('member-1'))
		).rejects.toThrow('Missing permission: member:invite');
		await expect(
			callHook(listInvitations, familyAdapterMock(), { query }, sessionOf('outsider-1'))
		).rejects.toThrow('Missing permission: member:invite');
	});
});

describe('tenancyConfig.endpoints denegados (administración del plugin)', () => {
	// El plugin monta por defecto endpoints de administración que solo piden
	// sesión; si alguno quedara sin hook, cualquier usuario autenticado podría
	// escalarse permisos. Aquí se comprueba que cada hook configurado rechaza;
	// que NO queda ningún endpoint sin clasificar lo fija el describe
	// «perímetro del plugin», que mira los endpoints reales del plugin.
	const deniedGroups: ['team' | 'role' | 'statement' | 'permission', string[]][] = [
		['team', ['create', 'read', 'update', 'delete', 'list']],
		['role', ['create', 'read', 'update', 'delete', 'addStatement', 'removeStatement', 'list']],
		['statement', ['create', 'read', 'update', 'delete', 'list', 'translate', 'batchCreate']],
		[
			'permission',
			[
				'grant',
				'deny',
				'revoke',
				'check',
				'listGrants',
				'listDenies',
				'contexts',
				'grantBatch',
				'denyBatch'
			]
		]
	];

	it('roles, statements, permisos y teams están cerrados en bloque', async () => {
		for (const [group, keys] of deniedGroups) {
			const hooks = tenancyConfig.endpoints?.[group];
			// Cada clave declarada existe y rechaza: el `denyEndpoints` real no es
			// un no-op (p. ej. nadie borró la denegación al refactorizar).
			expect(Object.keys(hooks ?? {}).sort()).toEqual([...keys].sort());
			for (const hook of Object.values(hooks ?? {})) {
				await expect(callHook(hook, familyAdapterMock(), {}, sessionOf('admin-1'))).rejects.toThrow(
					'disabled'
				);
			}
		}
	});

	it('las operaciones en bloque de miembros y la limpieza de invitaciones también', async () => {
		for (const hook of [
			tenancyConfig.endpoints?.member?.bulkAdd,
			tenancyConfig.endpoints?.member?.bulkRemove,
			tenancyConfig.endpoints?.member?.transfer,
			tenancyConfig.endpoints?.invitation?.cleanupExpired
		]) {
			await expect(callHook(hook, familyAdapterMock(), {}, sessionOf('admin-1'))).rejects.toThrow(
				'disabled'
			);
		}
	});
});

describe('perímetro del plugin (surface real de endpoints)', () => {
	// El mapa de `tenancyConfig.endpoints` es parcial por diseño (hooks solo en
	// lo que la app necesita), así que compararlo consigo mismo no demostraría
	// nada. Este test construye el plugin CON nuestra config y compara sus 52
	// endpoints reales contra esta clasificación: si una actualización del
	// plugin estrena o retira un endpoint, el listado deja de cuadrar y el test
	// obliga a clasificarlo (hook nuevo, denegación o apertura deliberada).
	const SURFACE: [path: string, guardia: string][] = [
		// organization: creación con tope; lectura de miembro; admin el resto;
		// listado filtrado por pertenencia (permissionFiltering).
		['/tenancy/organization/create', 'sesión + tope de familias'],
		['/tenancy/organization/:id', 'organization:get'],
		['/tenancy/organization/by-slug/:slug', 'organization:get'],
		['/tenancy/organization/update', 'organization:update'],
		['/tenancy/organization/delete', 'organization:delete'],
		['/tenancy/organization/list', 'filterOrganizations (pertenencia)'],
		// member: la clave `list` guarda también el GET por id, y `updateRole`
		// guarda el cambio de metadatos (así lo cablea el plugin).
		['/tenancy/member/list', 'organization:get'],
		['/tenancy/member/:id', 'organization:get (clave member.list)'],
		['/tenancy/member/add', 'member:invite'],
		['/tenancy/member/remove', 'member:remove'],
		['/tenancy/member/role/update', 'member:update'],
		['/tenancy/member/metadata/update', 'member:update (clave member.updateRole)'],
		['/tenancy/member/check', 'self-scoped en el plugin (requireSelfOr)'],
		['/tenancy/member/user/memberships', 'self-scoped en el plugin (requireSelfOr)'],
		// invitation: token = credenciales de la invitación.
		['/tenancy/invitation/create', 'member:invite'],
		['/tenancy/invitation/cancel', 'invitation:cancel'],
		['/tenancy/invitation/list', 'member:invite (llevan emails de terceros)'],
		['/tenancy/invitation/accept', 'token de la invitación'],
		['/tenancy/invitation/reject', 'token o código de la invitación'],
		['/tenancy/invitation/by-token/:token', 'token de la invitación'],
		['/tenancy/invitation/by-code/:code', 'código de la invitación'],
		['/tenancy/invitation/by-identifier', 'self-scoped en el plugin (requireSelfOr)'],
		['/tenancy/invitation/cleanup-expired', 'denegado (mantenimiento interno)'],
		// Administración del plugin que la app no expone: denegado en bloque.
		['/tenancy/team/create', 'denegado'],
		['/tenancy/team/:id', 'denegado'],
		['/tenancy/team/:parentType/:parentId/by-slug/:slug', 'denegado'],
		['/tenancy/team/update', 'denegado'],
		['/tenancy/team/delete', 'denegado'],
		['/tenancy/team/list', 'denegado'],
		['/tenancy/role/create', 'denegado'],
		['/tenancy/role/:id', 'denegado'],
		['/tenancy/role/update', 'denegado'],
		['/tenancy/role/delete', 'denegado'],
		['/tenancy/role/list', 'denegado'],
		['/tenancy/role/statement/add', 'denegado'],
		['/tenancy/role/statement/remove', 'denegado'],
		['/tenancy/role/translations/set', 'denegado (clave role.update)'],
		['/tenancy/statement/create', 'denegado'],
		['/tenancy/statement/:id', 'denegado'],
		['/tenancy/statement/update', 'denegado'],
		['/tenancy/statement/delete', 'denegado'],
		['/tenancy/statement/list', 'denegado'],
		['/tenancy/statement/batch-create', 'denegado'],
		['/tenancy/permission/grant', 'denegado'],
		['/tenancy/permission/deny', 'denegado'],
		['/tenancy/permission/revoke', 'denegado'],
		['/tenancy/permission/check', 'denegado'],
		['/tenancy/permission/grants', 'denegado'],
		['/tenancy/permission/denies', 'denegado'],
		['/tenancy/permission/grant-batch', 'denegado'],
		['/tenancy/permission/deny-batch', 'denegado'],
		// Self-scoped dentro del plugin: lista SOLO los contextos del usuario de
		// la sesión; no consulta hook (ver comentarios en tenancy.ts).
		['/tenancy/permission/contexts', 'self-scoped en el plugin']
	];

	it('cada endpoint del plugin está clasificado (hook, denegado o abierto a propósito)', () => {
		const plugin = tenancy(tenancyConfig);
		const actual = Object.values(plugin.endpoints)
			.map((endpoint) => endpoint.path)
			.sort();
		const expected = SURFACE.map(([path]) => path).sort();

		// Con este diff, si el plugin estrena un endpoint el fallo muestra
		// directamente cuál falta por clasificar.
		expect(actual).toEqual(expected);
	});

	it('el conteo cuadra (evita clasificaciones duplicadas que se anulen)', () => {
		const plugin = tenancy(tenancyConfig);
		expect(SURFACE).toHaveLength(Object.keys(plugin.endpoints).length);
	});
});

describe('tenancyConfig.endpoints.organization.create (tope de familias)', () => {
	const create = tenancyConfig.endpoints?.organization?.create;

	/** N membresías de organización para el usuario de la sesión. */
	function familiesAdapterMock(n: number) {
		return adapterMock(Array.from({ length: n }, (_, i) => ({ contextId: `fam-${i + 1}` })));
	}

	it(`con ${MAX_FAMILIES_PER_USER - 1} familias deja crear la siguiente`, async () => {
		await expect(
			callHook(create, familiesAdapterMock(MAX_FAMILIES_PER_USER - 1), {}, sessionOf('user-1'))
		).resolves.toBeUndefined();
	});

	it(`con ${MAX_FAMILIES_PER_USER} familias deniega la creación (403)`, async () => {
		await expect(
			callHook(create, familiesAdapterMock(MAX_FAMILIES_PER_USER), {}, sessionOf('user-1'))
		).rejects.toThrow('Family limit reached');
	});

	it('sin sesión pide autenticación', async () => {
		await expect(callHook(create, familiesAdapterMock(0), {})).rejects.toThrow(
			'Authentication required'
		);
	});
});

describe('tenancyConfig.endpoints.organization.read (statement del miembro)', () => {
	const read = tenancyConfig.endpoints?.organization?.read;

	it('un miembro ve su familia por id', async () => {
		await expect(
			callHook(read, familyAdapterMock(), { params: { id: 'fam-1' } }, sessionOf('member-1'))
		).resolves.toBeUndefined();
	});

	it('un miembro ve su familia por slug (el hook lo resuelve a la familia)', async () => {
		await expect(
			callHook(read, familyAdapterMock(), { params: { slug: 'fam-slug' } }, sessionOf('member-1'))
		).resolves.toBeUndefined();
	});

	it('quien no pertenece no ve la familia ni por id ni por slug', async () => {
		const adapter = familyAdapterMock();
		await expect(
			callHook(read, adapter, { params: { id: 'fam-1' } }, sessionOf('outsider-1'))
		).rejects.toThrow('Missing permission: organization:get');
		await expect(
			callHook(read, adapter, { params: { slug: 'fam-slug' } }, sessionOf('outsider-1'))
		).rejects.toThrow('Missing permission: organization:get');
	});

	it('un slug inexistente se deniega sin revelar si la familia existe', async () => {
		await expect(
			callHook(read, familyAdapterMock(), { params: { slug: 'no-existe' } }, sessionOf('member-1'))
		).rejects.toThrow('Missing permission: organization:get');
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

describe('tenancyConfig.actions.onInvitationCreated (correo de invitación, #60)', () => {
	/** Adaptador que resuelve la familia y el admin que invita. */
	function adapterOfInvitation() {
		return {
			async findOne({ model }: { model: string; where: { field: string; value: unknown }[] }) {
				if (model === 'organization') return { id: 'fam-1', name: 'Los Pérez' };
				if (model === 'user') return { id: 'admin-1', name: 'Ana', email: 'ana@example.com' };
				return null;
			}
		};
	}

	/** Endpoint context con el `request` real que lleva Accept-Language. */
	function ctxOfRequest(adapter: unknown, locale: string): GenericEndpointContext {
		return {
			context: { adapter },
			request: new Request('http://localhost/api/auth/tenancy/invitation/create', {
				headers: { 'accept-language': locale }
			})
		} as unknown as GenericEndpointContext;
	}

	function invitationEvent(
		identifier: string,
		contextType: 'organization' | 'team' = 'organization'
	) {
		return {
			invitationId: 'tok-1',
			identifier,
			contextType,
			contextId: 'fam-1',
			roleId: null,
			invitedBy: 'admin-1',
			token: 'tok-1',
			expiresAt: new Date(),
			timestamp: new Date()
		};
	}

	afterEach(() => {
		clearCapturedEmailsForTests();
	});

	it('envía el correo con el enlace del token, la familia y el invitador', async () => {
		await tenancyConfig.actions?.onInvitationCreated?.(
			invitationEvent('invitado@example.com'),
			ctxOfRequest(adapterOfInvitation(), 'es')
		);

		expect(capturedEmailsForTests()).toHaveLength(1);
		const email = capturedEmailsForTests()[0];
		expect(email.to).toBe('invitado@example.com');
		expect(email.text).toContain('/invitations/tok-1');
		expect(email.text).toContain('Los Pérez');
		expect(email.subject).toContain('Ana');
	});

	it('el idioma del correo sigue el Accept-Language de quien invita', async () => {
		await tenancyConfig.actions?.onInvitationCreated?.(
			invitationEvent('invitado@example.com'),
			ctxOfRequest(adapterOfInvitation(), 'es')
		);
		await tenancyConfig.actions?.onInvitationCreated?.(
			invitationEvent('invitado@example.com'),
			ctxOfRequest(adapterOfInvitation(), 'en-GB,en;q=0.9')
		);

		const [es, en] = capturedEmailsForTests();
		expect(es.subject).not.toBe(en.subject);
	});

	it('una invitación sin email no envía ningún correo', async () => {
		await expect(
			tenancyConfig.actions?.onInvitationCreated?.(
				invitationEvent(''),
				ctxOfRequest(adapterOfInvitation(), 'es')
			)
		).resolves.toBeUndefined();
		expect(capturedEmailsForTests()).toHaveLength(0);
	});

	it('los teams no generan correo de familia', async () => {
		await tenancyConfig.actions?.onInvitationCreated?.(
			invitationEvent('invitado@example.com', 'team'),
			ctxOfRequest(adapterOfInvitation(), 'es')
		);
		expect(capturedEmailsForTests()).toHaveLength(0);
	});

	it('sin familia (borrada entre medias) lanza y el plugin deshace la invitación', async () => {
		const adapter = {
			async findOne({ model }: { model: string }) {
				return model === 'user' ? { id: 'admin-1', email: 'ana@example.com' } : null;
			}
		};

		await expect(
			tenancyConfig.actions?.onInvitationCreated?.(
				invitationEvent('invitado@example.com'),
				ctxOfRequest(adapter, 'es')
			)
		).rejects.toThrow(/not found/i);
	});
});

describe('invitar: validación de duplicados y tope (#60)', () => {
	const request = {
		body: { identifier: 'invitado@example.com', contextType: 'organization', contextId: 'fam-1' }
	};

	/** Envoltorio que resuelve el usuario por email (el del mock base no lo hace). */
	function adapterWithEmails(emails: Record<string, string>) {
		const base = familyAdapterMock();
		return {
			findOne({ model, where }: { model: string; where: { field: string; value: unknown }[] }) {
				// Solo el lookup por email es nuestro (el de id lo resuelve el base).
				if (model === 'user' && where.some(({ field }) => field === 'email')) {
					const email = where.find(({ field }) => field === 'email')?.value;
					const userId = emails[email as string];
					return userId ? { id: userId } : null;
				}
				return base.findOne({ model, where });
			},
			findMany({ model, where }: { model: string; where: { field: string; value: unknown }[] }) {
				return base.findMany({ model, where });
			}
		};
	}

	/** Envoltorio con la familia llena (MAX_FAMILY_MEMBERS miembros). */
	function adapterWithFullFamily() {
		const base = familyAdapterMock();
		return {
			findOne({ model, where }: { model: string; where: { field: string; value: unknown }[] }) {
				return base.findOne({ model, where });
			},
			async findMany({
				model,
				where
			}: {
				model: string;
				where: { field: string; value: unknown }[];
			}) {
				// Solo el conteo de miembros es nuestro; el resto pasa tal cual (el
				// `where` vacío rompería el lookup de statements del mock base).
				if (model !== 'member') return base.findMany({ model, where });
				// Los rellenos van DESPUÉS de las membresías reales: `resolvePermission`
				// mira `members[0]` (el rol del admin) y el hook de tope cuenta todas.
				const memberships = await base.findMany({ model, where });
				return [
					...memberships,
					...Array.from({ length: MAX_FAMILY_MEMBERS }, (_, index) => ({
						id: `relleno-${index}`,
						userId: `user-${index}`,
						contextType: 'organization',
						contextId: 'fam-1'
					}))
				];
			}
		};
	}

	it('invitar a quien ya es miembro se deniega aunque sea admin', async () => {
		const adapter = adapterWithEmails({ 'miembro@example.com': 'member-1' });
		const pedido = {
			body: {
				identifier: 'miembro@example.com',
				contextType: 'organization',
				contextId: 'fam-1'
			}
		};

		await expect(
			callHook(tenancyConfig.endpoints?.invitation?.create, adapter, pedido, sessionOf('admin-1'))
		).rejects.toThrow(ALREADY_FAMILY_MEMBER_MESSAGE);
	});

	it('un email sin cuenta no es miembro: se deja invitar', async () => {
		const adapter = adapterWithEmails({});

		await expect(
			callHook(tenancyConfig.endpoints?.invitation?.create, adapter, request, sessionOf('admin-1'))
		).resolves.toBeUndefined();
	});

	it('invitar con la familia llena se deniega antes de gastar el correo', async () => {
		await expect(
			callHook(
				tenancyConfig.endpoints?.invitation?.create,
				adapterWithFullFamily(),
				request,
				sessionOf('admin-1')
			)
		).rejects.toThrow(FAMILY_MEMBERS_LIMIT_MESSAGE);
	});

	it('«ya es miembro» manda sobre «familia llena» (orden de las validaciones)', async () => {
		const adapter = adapterWithEmails({ 'miembro@example.com': 'member-1' });
		// La familia del mock base NO está llena, pero envolvemos el conteo con
		// la llena para ver cuál de las dos reglas dispara primero.
		const fullAdapter = adapterWithFullFamily();
		const bothAdapter = {
			findOne: adapter.findOne.bind(adapter),
			findMany: fullAdapter.findMany.bind(fullAdapter)
		};
		const pedido = {
			body: {
				identifier: 'miembro@example.com',
				contextType: 'organization',
				contextId: 'fam-1'
			}
		};

		await expect(
			callHook(
				tenancyConfig.endpoints?.invitation?.create,
				bothAdapter,
				pedido,
				sessionOf('admin-1')
			)
		).rejects.toThrow(ALREADY_FAMILY_MEMBER_MESSAGE);
	});
});
