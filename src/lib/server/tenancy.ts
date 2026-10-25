import type { AuthContext, GenericEndpointContext } from '@better-auth/core';
import type { EntityCreatedEvent, InvitationCreatedEvent } from '@zytera/better-auth-tenancy';
import type {
	ContextType,
	EndpointAuthContext,
	EndpointAuthHook,
	PermissionFilteringHooks,
	ResourceContext,
	TenancyConfig
} from '@zytera/better-auth-tenancy/server';
import { resolvePermission } from '@zytera/better-auth-tenancy/server';
import { APIError, getSessionFromCtx } from 'better-auth/api';

import { sendFamilyInvitationEmailFor } from './invitations.js';

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
 * No son decorativos: cada uno guarda los endpoints del plugin que ejecutan la
 * operación (ver `endpoints` en `tenancyConfig`), resuelto con el
 * `resolvePermission` del propio plugin — issue #59.
 */
export const FAMILY_ADMIN_STATEMENTS = [
	'organization:update', // Renombrar la familia
	'organization:delete', // Borrar la familia
	'member:invite', // Invitar a alguien a la familia
	'member:remove', // Quitar a un miembro
	'member:update', // Cambiar el rol de un miembro
	'invitation:cancel' // Cancelar invitaciones pendientes
] as const;

/**
 * Statements del rol básico: ver la familia, que es justo lo que su único
 * statement guarda (la lectura de la organización). Crecerá con las listas.
 */
export const FAMILY_MEMBER_STATEMENTS = ['organization:get'] as const;

/** Unión de todos los statements que siembra la app en los roles de familia. */
type FamilyStatement =
	(typeof FAMILY_ADMIN_STATEMENTS)[number] | (typeof FAMILY_MEMBER_STATEMENTS)[number];

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

/** Familia sobre la que recae un statement (los teams no se usan de momento). */
type StatementScope = { contextType: ContextType; contextId: string };

/**
 * Fábrica de hooks de autorización para los endpoints del plugin: exige que el
 * usuario de la sesión tenga el `statement` sobre la familia que resuelve
 * `scopeOf` y lanza 403 si no lo tiene.
 *
 * La resolución es la del propio plugin (`resolvePermission`): negaciones
 * explícitas (`permissionDeny`), concesiones (`permissionGrant`) y, sobre todo,
 * los statements del rol del miembro (`member` → `roleStatement`) — el modelo
 * que `seedFamilyRoles` siembra al crear cada familia.
 */
function requireFamilyStatement(
	statement: FamilyStatement,
	scopeOf: (context: EndpointAuthContext) => StatementScope | Promise<StatementScope>
): EndpointAuthHook {
	return async ({ ctx, session }) => {
		// Los endpoints del plugin resuelven la sesión antes de autorizar y la
		// pasan ya hecha; el fallback cubre el caso (teórico) de que no llegue.
		const current = session ?? (await getSessionFromCtx(ctx).catch(() => null));
		if (!current?.user) {
			throw new APIError('UNAUTHORIZED', {
				message: 'Authentication required. Please provide valid credentials.'
			});
		}

		const scope = await scopeOf({ ctx, session: current });
		if (!scope.contextType || !scope.contextId) {
			throw new APIError('BAD_REQUEST', {
				message: 'contextType and contextId are required to authorize this request.'
			});
		}

		const { allowed } = await resolvePermission(ctx.context.adapter, {
			userId: current.user.id,
			statementId: statement,
			contextType: scope.contextType,
			contextId: scope.contextId
		});
		if (!allowed) {
			// Mismo mensaje que el `requirePermission` del plugin.
			throw new APIError('FORBIDDEN', { message: `Missing permission: ${statement}` });
		}
	};
}

/** Familia señalada por su `id` en el body (renombrar y borrar la organización). */
const fromBodyOrganizationId = ({ ctx }: EndpointAuthContext): StatementScope => ({
	contextType: 'organization',
	contextId: ctx.body.id
});

/** Familia señalada por `contextType`/`contextId` en el body (invitar). */
const fromBodyContext = ({ ctx }: EndpointAuthContext): StatementScope => ({
	contextType: ctx.body.contextType,
	contextId: ctx.body.contextId
});

/**
 * Familia que el plugin ya resolvió y cuelga de `ctx.resource` (expulsar,
 * cambiar el rol, cancelar invitación): el endpoint busca el miembro o la
 * invitación ANTES de autorizar y nos ahorra la consulta.
 */
const fromResolvedResource = ({ ctx }: EndpointAuthContext): StatementScope => {
	const resource = ctx.resource as ResourceContext | undefined;
	if (!resource) {
		// Inalcanzable: los endpoints que usan este resolver inyectan `resource`
		// antes de autorizar (ver `members.js`/`invitations.js` del plugin).
		return { contextType: 'organization', contextId: '' };
	}
	return { contextType: resource.contextType, contextId: resource.contextId };
};

/** Familia señalada por `contextType`/`contextId` en el query (listados). */
const fromQueryContext = ({ ctx }: EndpointAuthContext): StatementScope => ({
	contextType: ctx.query.contextType,
	contextId: ctx.query.contextId
});

/**
 * Familia de un miembro: el listado la trae en el query (`member/list`) y
 * `member/:id` solo el id del miembro, que el endpoint no resuelve a su familia
 * hasta después de autorizar.
 */
const fromMemberRef = async ({ ctx }: EndpointAuthContext): Promise<StatementScope> => {
	if (ctx.query?.contextId) {
		return { contextType: ctx.query.contextType, contextId: ctx.query.contextId };
	}
	if (!ctx.params.id) {
		return { contextType: 'organization', contextId: '' };
	}

	const member = (await ctx.context.adapter.findOne({
		model: 'member',
		where: [{ field: 'id', value: ctx.params.id }]
	})) as StatementScope | null;
	// Miembro inexistente: cae al propio id y el `resolvePermission` lo denegará
	// (403, sin revelar si el miembro existe).
	return member ?? { contextType: 'organization', contextId: ctx.params.id };
};

/**
 * Endpoints que la app no expone: los roles, statements y permisos finos los
 * decide el servidor al sembrar cada familia (`seedFamilyRoles`), y ni los
 * teams ni las operaciones en bloque forman parte del producto. Sin este hook,
 * el plugin los deja pasar con solo una sesión válida — p. ej. cualquiera
 * podría auto-concederse `organization:update` sobre una familia ajena vía
 * `permission/grant`.
 */
const denyEndpoint: EndpointAuthHook = async () => {
	throw new APIError('FORBIDDEN', { message: 'This endpoint is disabled.' });
};

/** Deniega en bloque los endpoints del grupo cuyas claves se pasan. */
function denyEndpoints<const Keys extends readonly string[]>(
	keys: Keys
): { [K in Keys[number]]: EndpointAuthHook } {
	return Object.fromEntries(keys.map((key) => [key, denyEndpoint] as const)) as {
		[K in Keys[number]]: EndpointAuthHook;
	};
}

/**
 * Familia leída por id (`organization/:id`) o por slug
 * (`organization/by-slug/:slug`): dos endpoints comparten el hook de lectura y
 * cada uno trae su identificador en `params`.
 */
const fromOrganizationParams = async ({ ctx }: EndpointAuthContext): Promise<StatementScope> => {
	if (ctx.params.id) return { contextType: 'organization', contextId: ctx.params.id };

	const organization = (await ctx.context.adapter.findOne({
		model: 'organization',
		where: [{ field: 'slug', value: ctx.params.slug }]
	})) as { id: string } | null;
	// Un slug inexistente no encuentra familia: cae al propio slug y el
	// `resolvePermission` lo denegará (403, sin filtrar si existe o no).
	return { contextType: 'organization', contextId: organization?.id ?? ctx.params.slug };
};

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

/** Máximo de familias a las que puede pertenecer un usuario (issue #38). */
export const MAX_FAMILIES_PER_USER = 5;

/**
 * Máximo de miembros por familia. El plugin lo respeta al DAR de alta a un
 * miembro (`limits.maxMembersPerOrganization`, que se aplica al aceptar una
 * invitación), pero no al INVITAR, y una invitación ya cuesta un correo: se
 * comprueba también aquí, para que el admin lo vea como error de formulario y
 * no como un registro que fallará después (issue #60).
 */
export const MAX_FAMILY_MEMBERS = 20;

/**
 * Mensaje del 400 que lanza el endpoint `invitation/create` con la familia
 * llena. Es un contrato con `$lib/server/families.ts`, que lo traduce al error
 * de formulario (`FamilyMemberLimitReachedError`); no cambiarlo sin ajustar allí.
 */
export const FAMILY_MEMBERS_LIMIT_MESSAGE = `Family members limit reached: max ${MAX_FAMILY_MEMBERS}.`;

/** ¿Es este el error de familia llena que lanza el hook de invitar? */
export function isFamilyMembersLimitReached(error: unknown): boolean {
	return error instanceof APIError && error.message === FAMILY_MEMBERS_LIMIT_MESSAGE;
}

/** Mensaje del 400 para invitar a quien ya es miembro de la familia. */
export const ALREADY_FAMILY_MEMBER_MESSAGE = 'Already a member of the family';

/** ¿Es este el error de invitar a alguien que ya es miembro? */
export function isAlreadyFamilyMember(error: unknown): boolean {
	return error instanceof APIError && error.message === ALREADY_FAMILY_MEMBER_MESSAGE;
}

/**
 * Prefijo del 400 que lanza el PROPIO plugin (`invitation/create`) al encontrar
 * ya una invitación pendiente para el mismo email en la familia: el duplicado
 * que la lista «validación de duplicados» de la issue #60 exige vigilar.
 */
export const FAMILY_INVITATION_PENDING_PREFIX = 'Pending invitation already exists';

/** ¿Es este el error de invitación pendiente duplicada del plugin? */
export function isFamilyInvitationPending(error: unknown): boolean {
	return (
		error instanceof APIError && (error.message ?? '').startsWith(FAMILY_INVITATION_PENDING_PREFIX)
	);
}

/**
 * Mensaje del 403 que lanza el endpoint `organization/create` al superar el
 * tope. Es un contrato con `$lib/server/families.ts`, que lo traduce al error
 * de formulario (`FamilyLimitReachedError`); no cambiarlo sin ajustar allí.
 */
export const FAMILY_LIMIT_MESSAGE = `Family limit reached: max ${MAX_FAMILIES_PER_USER}.`;

/** ¿Es este el error de tope de familias que lanza el hook de creación? */
export function isFamilyLimitReached(error: unknown): boolean {
	return error instanceof APIError && error.message === FAMILY_LIMIT_MESSAGE;
}

/** Nº de familias del usuario (membresías de tipo organization). */
async function countUserFamilies(adapter: Adapter, userId: string): Promise<number> {
	const memberships = await adapter.findMany<{ contextId: string }>({
		model: 'member',
		where: [
			{ field: 'userId', value: userId },
			{ field: 'contextType', value: 'organization' }
		]
	});
	return memberships.length;
}

/**
 * El plugin no trae tope de organizaciones por usuario (`HierarchyLimits`
 * solo cubre teams/members/roles), y sin él cualquier usuario autenticado
 * podría sembrar familias en bucle (~12 filas por familia; el rate limit de
 * better-auth es por petición, no por recurso creado).
 */
const requireBelowFamilyLimit: EndpointAuthHook = async ({ ctx, session }) => {
	// Mismo fallback que `requireFamilyStatement`: el endpoint resuelve la
	// sesión antes de autorizar; el cubre el caso (teórico) de que no llegue.
	const current = session ?? (await getSessionFromCtx(ctx).catch(() => null));
	if (!current?.user) {
		throw new APIError('UNAUTHORIZED', {
			message: 'Authentication required. Please provide valid credentials.'
		});
	}

	const families = await countUserFamilies(ctx.context.adapter, current.user.id);
	if (families >= MAX_FAMILIES_PER_USER) {
		throw new APIError('FORBIDDEN', { message: FAMILY_LIMIT_MESSAGE });
	}
};

/**
 * Combina hooks de autorización en uno: se ejecutan en orden y el primero que
 * lanza corta (el plugin solo consulta UN hook por endpoint).
 */
function combineHooks(...hooks: EndpointAuthHook[]): EndpointAuthHook {
	return async (context) => {
		for (const hook of hooks) {
			await hook(context);
		}
	};
}

/** Sesión del endpoint; los hooks del plugin la traen ya resuelta. */
async function endpointSession(
	ctx: GenericEndpointContext,
	session: EndpointAuthContext['session']
) {
	// Mismo fallback que `requireFamilyStatement` y `requireBelowFamilyLimit`.
	const current = session ?? (await getSessionFromCtx(ctx).catch(() => null));
	if (!current?.user) {
		throw new APIError('UNAUTHORIZED', {
			message: 'Authentication required. Please provide valid credentials.'
		});
	}
	return current;
}

/**
 * El email del invitado, normalizado como better-auth guarda los correos
 * (en minúsculas; el body del plugin no lo normaliza). `undefined` si no viene.
 */
function invitedEmail(ctx: GenericEndpointContext): string | undefined {
	const identifier = ctx.body?.identifier;
	return typeof identifier === 'string' && identifier ? identifier.trim().toLowerCase() : undefined;
}

/**
 * Invitar a quien ya es miembro (400): el plugin solo evita invitaciones
 * pendientes duplicadas, así que un miembro actual seguiría recibiendo (y
 * pudiendo aceptar) invitaciones nuevas. Sin cuenta no puede ser miembro: se
 * deja pasar sin comprobar, porque la invitación es justo lo que lo traerá.
 */
const requireNotAlreadyFamilyMember: EndpointAuthHook = async ({ ctx, session }) => {
	await endpointSession(ctx, session);
	const contextId = ctx.body?.contextId;
	if (typeof contextId !== 'string' || !contextId) {
		// Solo al PokeYolo de una petición hecha a mano: el statement del plugin
		// (primero en el orden de `combineHooks`) ya deniega el body sin familia.
		return;
	}
	const email = invitedEmail(ctx);
	if (!email) return;

	const user = await ctx.context.adapter.findOne({
		model: 'user',
		where: [{ field: 'email', value: email }]
	});
	if (!user) return;

	const memberships = await ctx.context.adapter.findMany({
		model: 'member',
		where: [
			{ field: 'userId', value: user.id },
			{ field: 'contextType', value: 'organization' },
			{ field: 'contextId', value: contextId }
		]
	});
	if (memberships.length > 0) {
		throw new APIError('BAD_REQUEST', { message: ALREADY_FAMILY_MEMBER_MESSAGE });
	}
};

/**
 * Invitar con la familia llena (400): el plugin ya deniega el ALTA de miembros
 * pasados el tope (`limits.maxMembersPerOrganization`), pero no la invitación;
 * fallar aquí ahorra un correo imposible de usar.
 */
const requireBelowFamilyMemberLimit: EndpointAuthHook = async ({ ctx, session }) => {
	await endpointSession(ctx, session);
	const contextId = ctx.body?.contextId;
	if (typeof contextId !== 'string' || !contextId) return;

	const members = await ctx.context.adapter.findMany({
		model: 'member',
		where: [
			{ field: 'contextType', value: 'organization' },
			{ field: 'contextId', value: contextId }
		]
	});
	if (members.length >= MAX_FAMILY_MEMBERS) {
		throw new APIError('BAD_REQUEST', { message: FAMILY_MEMBERS_LIMIT_MESSAGE });
	}
};

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

	// Un miembro no entra en una familia llena: lo comprueba el propio plugin
	// al dar de alta (`member/add`, que es lo que ejecuta la aceptación de la
	// issue #61). Al invitar lo replica `requireBelowFamilyMemberLimit`.
	limits: { maxMembersPerOrganization: MAX_FAMILY_MEMBERS },

	// Autorización por statements (issue #59): el plugin NO comprueba los
	// statements por sí solo — los consulta a través de estos hooks. Cada
	// statement de admin guarda la operación que ejecuta; la lectura de la
	// familia y de sus miembros queda en manos del statement del miembro
	// (`organization:get`), así nadie ve familias ajenas ni por id ni por slug.
	// El listado de familias no se toca: ya lo filtra por membresía
	// `permissionFiltering.filterOrganizations`.
	//
	// Todo lo que la app no usa se deniega en bloque: el plugin monta por
	// defecto endpoints de administración (roles, statements, permisos, teams)
	// que solo exigen sesión, y por ahí un usuario cualquiera podría escalarse
	// permisos en cualquier familia. Las invitaciones se aceptan con su token,
	// así que `accept`/`decline`/`getByToken` no necesitan hook; en cambio su
	// listado (emails de invitados) es cosa del admin.
	endpoints: {
		// `create` pide sesión y tope de familias por usuario (`MAX_FAMILIES_PER_USER`):
		// crear la propia familia sí que está abierto al mundo con sesión.
		organization: {
			create: requireBelowFamilyLimit,
			read: requireFamilyStatement('organization:get', fromOrganizationParams),
			update: requireFamilyStatement('organization:update', fromBodyOrganizationId),
			delete: requireFamilyStatement('organization:delete', fromBodyOrganizationId)
		},
		member: {
			add: requireFamilyStatement('member:invite', fromBodyContext),
			remove: requireFamilyStatement('member:remove', fromResolvedResource),
			updateRole: requireFamilyStatement('member:update', fromResolvedResource),
			// Ver quiénes son los miembros: cualquiera de la familia.
			list: requireFamilyStatement('organization:get', fromMemberRef),
			...denyEndpoints(['bulkAdd', 'bulkRemove', 'transfer'])
		},
		invitation: {
			// Flujo de invitar (#60): primero el statement (403 a quien no
			// administra la familia) y después las validaciones (400), con la
			// más específica delante.
			create: combineHooks(
				requireFamilyStatement('member:invite', fromBodyContext),
				requireNotAlreadyFamilyMember,
				requireBelowFamilyMemberLimit
			),
			revoke: requireFamilyStatement('invitation:cancel', fromResolvedResource),
			// Las invitaciones pendientes llevan emails de terceros: solo admin.
			list: requireFamilyStatement('member:invite', fromQueryContext),
			// Mantenimiento interno (cron), no se expone al cliente.
			cleanupExpired: denyEndpoint
		},
		team: denyEndpoints(['create', 'read', 'update', 'delete', 'list']),
		role: denyEndpoints([
			'create',
			'read',
			'update',
			'delete',
			'addStatement',
			'removeStatement',
			'list'
		]),
		statement: denyEndpoints([
			'create',
			'read',
			'update',
			'delete',
			'list',
			// El tipo del plugin la declara, pero hoy no hay endpoint que la
			// consulte (statements.js solo monta create/read/update/delete/
			// list/batchCreate). Se deniega por si una versión futura la usa.
			'translate',
			'batchCreate'
		]),
		permission: denyEndpoints([
			'grant',
			'deny',
			'revoke',
			'check',
			'listGrants',
			'listDenies',
			// Igual que `statement.translate`: declarada en el tipo, pero el
			// endpoint `permission/contexts` es self-scoped dentro del plugin
			// (lista SOLO los contextos del usuario de la sesión) y nunca
			// consulta este hook. Denegada por si eso cambia.
			'contexts',
			'grantBatch',
			'denyBatch'
		])
	},

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
		},

		// El email de invitación es parte del flujo de invitar (issue #60, con el
		// proveedor de la #80): el plugin solo registra la invitación y el correo
		// con su token sale de aquí. Lanzar deshace la invitación dentro del
		// plugin, así que no queda nunca una invitación registrada sin correo.
		onInvitationCreated: async (event: InvitationCreatedEvent, ctx) => {
			if (event.contextType !== 'organization') return;
			await sendFamilyInvitationEmailFor(event, ctx);
		}
	}
};
