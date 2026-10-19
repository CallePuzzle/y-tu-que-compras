import type { AuthContext, GenericEndpointContext } from '@better-auth/core';
import type { EntityCreatedEvent } from '@zytera/better-auth-tenancy';
import type { PermissionFilteringHooks, TenancyConfig } from '@zytera/better-auth-tenancy/server';
import { getSessionFromCtx } from 'better-auth/api';

// El plugin de tenancy mapea la jerarquía de better-auth sobre el dominio de la
// app: **familia = organization**. Los equipos (teams) no se usan de momento.

/**
 * Adaptador interno de better-auth (`ctx.context.adapter`): es el que los hooks
 * del plugin reciben y el mismo que el seed usa para crear los roles, así que
 * funciona igual con el adaptador Prisma que con un mock en los tests.
 */
type Adapter = AuthContext['adapter'];

/**
 * Nombre del rol de administración de una familia. Es un identificador de
 * programa (estable, en minúsculas): el nombre visible por idioma vive en
 * `roleTranslation` y lo resuelve el plugin según `Accept-Language`.
 */
export const FAMILY_ADMIN_ROLE = 'admin';

/** Nombre del rol básico de una familia. Mismas reglas que `FAMILY_ADMIN_ROLE`. */
export const FAMILY_MEMBER_ROLE = 'member';

/**
 * Statements del rol de administración. Formato canónico del plugin
 * `categoria:operacion` (un solo `:`): así podrían catalogarse en `statement`
 * con traducciones más adelante sin cambiar los ids.
 *
 * De momento ningún endpoint los consulta: los hooks de autorización fina se
 * conectarán al asignar roles a usuarios (issue #59). Sembrarlos ya deja el
 * modelo de permisos definido en un solo sitio.
 */
export const FAMILY_ADMIN_STATEMENTS = [
	'organization:update', // Renombrar la familia
	'organization:delete', // Borrar la familia
	'member:invite', // Invitar a alguien a la familia
	'member:remove', // Quitar a un miembro
	'member:update', // Cambiar el rol de un miembro
	'invitation:cancel' // Cancelar invitaciones pendientes
] as const;

/** Statements del rol básico: ver la familia. Crecerá con las listas. */
export const FAMILY_MEMBER_STATEMENTS = ['organization:get'] as const;

/** Nombre visible del rol según locale (fallback: el `name` del rol). */
const FAMILY_ROLE_TRANSLATIONS: Record<string, Record<string, string>> = {
	[FAMILY_ADMIN_ROLE]: { es: 'Administrador', en: 'Admin' },
	[FAMILY_MEMBER_ROLE]: { es: 'Miembro', en: 'Member' }
};

/**
 * Crea un rol de familia con sus statements y traducciones, vía el adaptador de
 * better-auth. Los ids los genera el adaptador; las fechas van explícitas para
 * no depender de que el campo llegue al default de Prisma.
 */
async function createFamilyRole(
	adapter: Adapter,
	familyId: string,
	roleName: string,
	statements: readonly string[]
): Promise<{ id: string }> {
	const role = await adapter.create<{ id: string }>({
		model: 'role',
		data: {
			contextType: 'organization',
			contextId: familyId,
			name: roleName,
			createdAt: new Date(),
			updatedAt: new Date()
		}
	});

	for (const statementId of statements) {
		await adapter.create({
			model: 'roleStatement',
			data: { roleId: role.id, statementId, createdAt: new Date() }
		});
	}

	for (const [locale, name] of Object.entries(FAMILY_ROLE_TRANSLATIONS[roleName])) {
		await adapter.create({
			model: 'roleTranslation',
			data: { roleId: role.id, locale, name, createdAt: new Date() }
		});
	}

	return role;
}

/**
 * Siembra los roles `admin` y `member` de una familia recién creada y devuelve
 * el id del rol admin (para asignárselo a quien la creó).
 *
 * Se llama desde `onEntityCreated`, así que si algo falla el plugin deshace la
 * creación de la familia y el error llega al cliente: no hay familia a medias.
 * (Los roles de una familia deshecha pueden quedar huérfanos —`contextId` es
 * polimórfico y no lleva FK—, pero son basura inofensiva e inalcanzable.)
 */
export async function seedFamilyRoles(adapter: Adapter, familyId: string): Promise<string> {
	const adminRole = await createFamilyRole(
		adapter,
		familyId,
		FAMILY_ADMIN_ROLE,
		FAMILY_ADMIN_STATEMENTS
	);
	await createFamilyRole(adapter, familyId, FAMILY_MEMBER_ROLE, FAMILY_MEMBER_STATEMENTS);
	return adminRole.id;
}

/**
 * Filtra organizaciones dejando solo las donde el usuario es miembro.
 *
 * Sin este hook `organization/list` devolvería las familias de todo el mundo a
 * cualquier usuario autenticado (el plugin solo exige sesión por defecto); con
 * él, el listado alimenta el selector de familias tal y como pide la issue
 * padre (#38).
 */
async function filterOrganizations<T extends { id: string }>(
	ctx: GenericEndpointContext,
	organizations: T[]
): Promise<T[]> {
	const session = await getSessionFromCtx(ctx).catch(() => null);
	if (!session?.user) return [];

	const memberships = await ctx.context.adapter.findMany<{
		contextId: string;
	}>({
		model: 'member',
		where: [
			{ field: 'userId', value: session.user.id },
			{ field: 'contextType', value: 'organization' }
		]
	});

	const familyIds = new Set(memberships.map((membership) => membership.contextId));
	return organizations.filter((organization) => familyIds.has(organization.id));
}

/**
 * Configuración del plugin `tenancy` para `getBetterAuth` (`src/lib/server/
 * auth.ts`).
 *
 * El plugin NO expone ninguna organización activa en la sesión: su único estado
 * de sesión es el de better-auth base. Lo comprobé revisando el `schema` y los
 * endpoints del plugin (no hay `/organization/active` ni campos adicionales en
 * session/user), así que la cookie de organización activa de la issue #63
 * sigue siendo necesaria.
 */
export const tenancyConfig: TenancyConfig = {
	// Mensajes de error del plugin en español cuando la petición no trae
	// Accept-Language (las peticiones del navegador llevan la locale activa de
	// Paraglide vía el cliente: ver `src/lib/auth-client.ts`).
	i18n: { defaultLocale: 'es' },

	permissionFiltering: {
		// El cast documenta el contrato real del hook: el plugin pasa
		// organizaciones con `id` (su signatura pública es genérica en `T`).
		filterOrganizations: filterOrganizations as PermissionFilteringHooks['filterOrganizations']
	},

	actions: {
		// Al crear una familia se siembran sus roles y se da de alta al creador
		// como miembro con rol admin (criterio de la issue padre #38: el plugin
		// deja la tabla `member` vacía al crear una organización). Solo
		// organization: los teams no forman parte del dominio (una familia no
		// tiene subgrupos).
		onEntityCreated: async (event: EntityCreatedEvent, ctx) => {
			if (event.entityType !== 'organization') return;
			const adminRoleId = await seedFamilyRoles(ctx.context.adapter, event.entityId);
			await ctx.context.adapter.create({
				model: 'member',
				data: {
					contextType: 'organization',
					contextId: event.entityId,
					userId: event.createdBy,
					roleId: adminRoleId,
					createdAt: new Date(),
					updatedAt: new Date()
				}
			});
		}
	}
};
