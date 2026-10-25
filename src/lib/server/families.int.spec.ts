import { randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Test de INTEGRACIÓN (proyecto vitest `integration`): a diferencia de
// `tenancy.spec.ts` (mock del adaptador), aquí corre el adaptador Prisma real
// contra un Postgres con las migraciones aplicadas. Es la red que cubre lo que
// un mock no puede: el mapeo de modelos (`role`, `roleStatement`,
// `roleTranslation`, `member`) entre el plugin de tenancy y el esquema, el seed
// completo de una familia y los hooks de autorización con consultas reales.
//
// Las llamadas van por el router HTTP (`auth.handler`), igual que desde el
// navegador: es la ruta completa (middleware de sesión, hooks del plugin y el
// after-hook de cookies de SvelteKit, que solo corta pronto con el flag de
// router). `DATABASE_URL` debe apuntar a una base DESCARTABLE con las
// migraciones aplicadas (postgres local o el service del CI). Cada test usa
// ids/emails únicos: no hace falta limpiar ni coordinar ejecuciones.
import { auth } from './auth.js';
import { FAMILY_ADMIN_ROLE, FAMILY_MEMBER_ROLE, MAX_FAMILIES_PER_USER } from './tenancy.js';
import {
	FamilyLastAdminError,
	FamilyMemberGoneError,
	deleteFamily,
	familyDetailView,
	familySlug,
	inviteFamily,
	leaveFamily,
	promoteFamilyMember,
	removeFamilyMember
} from './families.js';
import { capturedEmailsForTests, clearCapturedEmailsForTests } from './sender.js';
import prisma from './prisma.js';

const BASE = 'http://localhost:4173/api/auth';

/** Crea un usuario real y devuelve su Cookie de sesión, id y email. */
async function sessionCookieFor(
	name: string
): Promise<{ cookie: string; userId: string; email: string }> {
	const userId = randomUUID();
	const email = `${userId}@integration.test`;
	await prisma.user.create({
		data: {
			id: userId,
			name,
			email,
			emailVerified: false,
			createdAt: new Date(),
			updatedAt: new Date()
		}
	});

	// Sesión creada directamente en la base: el flujo OTP necesita un SMTP o el
	// transporte capturado de dev. La cookie se firma a mano con el mismo
	// esquema que `setSessionCookie` de better-auth (`token.firma` HMAC-SHA256
	// en base64, URL-encodeado). El secret se saca del CONTEXTO de better-auth
	// (el que realmente verificará la cookie, sea el del `.env` o el fallback
	// de better-auth cuando no hay ninguno): leer `$env/dynamic/private` a pelo
	// sería frágil porque ese env se congela al arrancar vitest.
	//
	// Caducidad LARGA (30 días) y no una hora: con una sesión próxima a caducar
	// better-auth la REFRESCA en cada `getSession` (updateAge) y responde con
	// `Set-Cookie`; el after-hook de `sveltekitCookies` lo reproduce en el
	// evento de SvelteKit, que solo existe dentro de `handle` — fuera (las
	// llamadas directas a `auth.api.*` de estos tests) revienta. Con el refresh
	// desactivado la respuesta no lleva cookies y las llamadas directas no
	// tocan ese camino.
	const context = await auth.$context;
	const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
	await prisma.session.create({
		data: {
			id: randomUUID(),
			token,
			expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			userId
		}
	});

	const signature = await makeSignature(token, String(context.secret));
	// `useSecureCookies: !dev` y en vitest `dev` es true (`import.meta.env.DEV`):
	// la cookie va sin el prefijo `__Secure-`.
	return {
		cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
		userId,
		email
	};
}

function tenancyRequest(
	path: string,
	cookie: string,
	init?: { method?: string; body?: unknown }
): Request {
	return new Request(`${BASE}/tenancy/${path}`, {
		method: init?.method ?? 'GET',
		headers: { cookie, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
		body: init?.body ? JSON.stringify(init.body) : undefined
	});
}

async function createFamilyViaApi(cookie: string, name: string): Promise<Response> {
	return auth.handler(
		tenancyRequest('organization/create', cookie, {
			method: 'POST',
			body: { name, slug: familySlug(name) }
		})
	);
}

describe('seed de una familia (adaptador Prisma real)', () => {
	it('crear una familia siembra roles, statements, traducciones y al admin', async () => {
		const { cookie } = await sessionCookieFor('Creador');
		const name = `Familia Integración ${randomUUID().slice(0, 8)}`;

		const response = await createFamilyViaApi(cookie, name);
		expect(response.ok).toBe(true);
		const { id: organizationId } = (await response.json()) as { id: string };

		const roles = await prisma.role.findMany({ where: { contextId: organizationId } });
		expect(roles.map((role) => role.name).sort()).toEqual(['admin', 'member']);

		const adminRole = roles.find((role) => role.name === 'admin');
		const memberRole = roles.find((role) => role.name === 'member');
		if (!adminRole || !memberRole) {
			throw new Error('Los roles admin y member no están sembrados');
		}

		// Statements: los 6 del admin y el 1 del member, con los ids de programa.
		const adminStatements = await prisma.roleStatement.findMany({
			where: { roleId: adminRole.id }
		});
		const memberStatements = await prisma.roleStatement.findMany({
			where: { roleId: memberRole.id }
		});
		expect(adminStatements.map((rs) => rs.statementId).sort()).toEqual([
			'invitation:cancel',
			'member:invite',
			'member:remove',
			'member:update',
			'organization:delete',
			'organization:update'
		]);
		expect(memberStatements.map((rs) => rs.statementId)).toEqual(['organization:get']);

		// Traducciones es/en de ambos roles.
		const translations = await prisma.roleTranslation.findMany({
			where: { roleId: { in: [adminRole.id, memberRole.id] } }
		});
		expect(translations).toHaveLength(4);
		expect(
			translations
				.filter((t) => t.locale === 'es')
				.map((t) => t.name)
				.sort()
		).toEqual(['Administrador', 'Miembro']);

		// El creador queda de alta como miembro admin (lo hace `onEntityCreated`).
		const memberships = await prisma.member.findMany({
			where: { contextId: organizationId }
		});
		expect(memberships).toHaveLength(1);
		expect(memberships[0].roleId).toBe(adminRole.id);
	});

	it('el listado solo devuelve las familias del usuario de la sesión', async () => {
		const { cookie } = await sessionCookieFor('Listador');
		const name = `Familia Listado ${randomUUID().slice(0, 8)}`;

		const created = await createFamilyViaApi(cookie, name);
		expect(created.ok).toBe(true);

		const response = await auth.handler(tenancyRequest('organization/list', cookie));
		expect(response.ok).toBe(true);
		const { items } = (await response.json()) as { items: { name: string }[] };
		expect(items.map((organization) => organization.name)).toContain(name);
	});
});

describe('tope de familias por usuario (hook organization/create real)', () => {
	it(`la ${MAX_FAMILIES_PER_USER + 1}ª familia del usuario se le deniega`, async () => {
		const { cookie } = await sessionCookieFor('Topador');

		for (let i = 0; i < MAX_FAMILIES_PER_USER; i++) {
			const response = await createFamilyViaApi(
				cookie,
				`Familia Tope ${randomUUID().slice(0, 8)} ${i}`
			);
			expect(response.ok).toBe(true);
		}

		// El hook cuenta membresías reales: 5 familias → el 6º create es 403.
		const response = await createFamilyViaApi(
			cookie,
			`Familia Tope ${randomUUID().slice(0, 8)} extra`
		);
		expect(response.status).toBe(403);
		expect(await response.text()).toContain('Family limit reached');
	});
});

describe('unicidad de pertenencia (constraint member)', () => {
	it('el mismo usuario no puede pertenecer dos veces a la misma familia', async () => {
		const { cookie } = await sessionCookieFor('Duplicado');
		const name = `Familia Duplicada ${randomUUID().slice(0, 8)}`;

		const created = await createFamilyViaApi(cookie, name);
		expect(created.ok).toBe(true);
		const { id: organizationId } = (await created.json()) as { id: string };

		const membership = await prisma.member.findFirstOrThrow({
			where: { contextId: organizationId }
		});

		// `member/add` del plugin no comprueba duplicados: la garantía es de la
		// base de datos (P2002 de Prisma sobre la clave única).
		await expect(
			prisma.member.create({
				data: {
					id: randomUUID(),
					contextType: 'organization',
					contextId: organizationId,
					userId: membership.userId,
					roleId: membership.roleId,
					createdAt: new Date(),
					updatedAt: new Date()
				}
			})
		).rejects.toThrow(/unique|duplicate/i);
	});
});

/**
 * Invitar por email (issue #60). El flujo completo por HTTP: el admin crea la
 * familia, invita y el correo sale con el token; los duplicados y los no-admin
 * se deniegan. (El alta por invitación, en el describe «aceptar y rechazar»
 * de abajo.)
 */
describe('invitar por email (#60)', () => {
	/** Crea familia y devuelve su id. */
	async function createFamily(cookie: string, prefix: string): Promise<string> {
		const name = `${prefix} ${randomUUID().slice(0, 8)}`;
		const created = await createFamilyViaApi(cookie, name);
		expect(created.ok).toBe(true);
		const { id } = (await created.json()) as { id: string };
		return id;
	}

	/** Da de alta en la base a un miembro con rol `member` (el alta real es la #61). */
	async function addMember(familyId: string): Promise<{ userId: string; email: string }> {
		const userId = randomUUID();
		const email = `miembro-${userId.slice(0, 8)}@example.com`;
		await prisma.user.create({
			data: {
				id: userId,
				name: 'Miembro',
				email,
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		});
		const memberRole = await prisma.role.findFirstOrThrow({
			where: { contextType: 'organization', contextId: familyId, name: FAMILY_MEMBER_ROLE }
		});
		await prisma.member.create({
			data: {
				id: randomUUID(),
				contextType: 'organization',
				contextId: familyId,
				userId,
				roleId: memberRole.id,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		});
		return { userId, email };
	}

	async function inviteViaApi(cookie: string, familyId: string, email: string): Promise<Response> {
		return auth.handler(
			tenancyRequest('invitation/create', cookie, {
				method: 'POST',
				body: { identifier: email, contextType: 'organization', contextId: familyId }
			})
		);
	}

	it('el admin invita y sale el correo con el token, la familia y su nombre', async () => {
		const { cookie } = await sessionCookieFor('Invitador');
		const familyId = await createFamily(cookie, 'Familia Invitada');

		clearCapturedEmailsForTests();
		const email = `invitado-${randomUUID().slice(0, 8)}@example.com`;
		const response = await inviteViaApi(cookie, familyId, email);
		// El plugin responde 200 (no 201) a través del router HTTP de better-auth.
		expect(response.ok).toBe(true);

		// La invitación queda pendiente. El `roleId` de entrada lo añade la capa
		// de app (`inviteFamily`, que no pasa por aquí): a este nivel el rol
		// `member` de la familia existe porque el seed lo dejó sembrado.
		const memberRole = await prisma.role.findFirstOrThrow({
			where: { contextType: 'organization', contextId: familyId, name: FAMILY_MEMBER_ROLE }
		});
		expect(memberRole.name).toBe('member');
		const invitation = await prisma.invitation.findFirstOrThrow({
			where: { identifier: email, contextId: familyId }
		});
		expect(invitation.status).toBe('pending');

		// Y el correo sale con el enlace del token (el hook `onInvitationCreated`).
		const [captured] = capturedEmailsForTests();
		expect(captured?.to).toBe(email);
		expect(captured?.text).toContain(`/invitations/${invitation.token}`);
		expect(captured?.text).toContain('Familia Invitada');
		expect(captured?.subject).toContain('Invitador');
	});

	it('una segunda invitación pendiente para el mismo email se deniega', async () => {
		const { cookie } = await sessionCookieFor('Duplicador');
		const familyId = await createFamily(cookie, 'Familia Duplicada');
		const email = `duplicado-${randomUUID().slice(0, 8)}@example.com`;

		const first = await inviteViaApi(cookie, familyId, email);
		expect(first.ok).toBe(true);

		const second = await inviteViaApi(cookie, familyId, email);
		expect(second.status).toBe(400);
		expect(await second.text()).toContain('Pending invitation already exists');
	});

	it('invitar a quien ya es miembro se deniega aunque sea el admin', async () => {
		const { cookie } = await sessionCookieFor('Reinvitador');
		const familyId = await createFamily(cookie, 'Familia Reinvitada');
		const { email } = await addMember(familyId);

		const response = await inviteViaApi(cookie, familyId, email);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain('Already a member of the family');
	});

	it('un miembro sin rol admin no puede invitar', async () => {
		const admin = await sessionCookieFor('Admin Ajeno');
		const familyId = await createFamily(admin.cookie, 'Familia Ajena');
		const member = await sessionCookieFor('Miembro Sin Rol');
		// Alta real del usuario de la sesión como miembro (la invitación directa
		// se lo prohibiría y aquí interesa solo la pertenencia).
		const memberRole = await prisma.role.findFirstOrThrow({
			where: { contextType: 'organization', contextId: familyId, name: FAMILY_MEMBER_ROLE }
		});
		await prisma.member.create({
			data: {
				id: randomUUID(),
				contextType: 'organization',
				contextId: familyId,
				userId: member.userId,
				roleId: memberRole.id,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		});

		const response = await inviteViaApi(
			member.cookie,
			familyId,
			`alguien-${randomUUID().slice(0, 8)}@example.com`
		);
		expect(response.status).toBe(403);
	});
});

/**
 * Aceptar o rechazar la invitación (issue #61), por la ruta completa del
 * router HTTP: el hook `invitation/accept`/`decline` (sesión con el email del
 * invitado), la validación de estado/caducidad del plugin y el alta real del
 * miembro de `onInvitationAccepted`. Criterio de aceptación: al aceptar, el
 * invitado es miembro y la familia sale en SU listado (el «selector»).
 */
describe('aceptar y rechazar invitación (#61)', () => {
	/** Evento mínimo para las funciones de `$lib/server/families.ts`. */
	function eventOf(cookie: string): RequestEvent {
		return {
			request: new Request(BASE, { headers: { cookie } })
		} as unknown as RequestEvent;
	}

	/** Crea familia y devuelve su id. */
	async function createFamilyFor(cookie: string): Promise<string> {
		const created = await createFamilyViaApi(
			cookie,
			`Familia Respuesta ${randomUUID().slice(0, 8)}`
		);
		expect(created.ok).toBe(true);
		const { id } = (await created.json()) as { id: string };
		return id;
	}

	/** Crea familia, invita al email y devuelve el token de la invitación. */
	async function invitedToken(
		admin: { cookie: string },
		guestEmail: string
	): Promise<{ familyId: string; token: string }> {
		const familyId = await createFamilyFor(admin.cookie);

		// La invitación va por la función de app (`inviteFamily`): es la que fija
		// el rol `member` de entrada que la aceptación debe respetar.
		await inviteFamily(eventOf(admin.cookie), { familyId, email: guestEmail });

		const invitation = await prisma.invitation.findFirstOrThrow({
			where: { identifier: guestEmail, contextId: familyId }
		});
		return { familyId, token: invitation.token };
	}

	async function acceptViaApi(cookie: string, token: string): Promise<Response> {
		return auth.handler(
			tenancyRequest('invitation/accept', cookie, { method: 'POST', body: { token } })
		);
	}

	async function rejectViaApi(cookie: string, token: string): Promise<Response> {
		return auth.handler(
			tenancyRequest('invitation/reject', cookie, { method: 'POST', body: { token } })
		);
	}

	it('al aceptar, el invitado es miembro y la familia sale en su listado', async () => {
		const admin = await sessionCookieFor('Admin Anfitrión');
		const guest = await sessionCookieFor('Invitada Que Acepta');
		const { familyId, token } = await invitedToken(admin, guest.email);

		const accepted = await acceptViaApi(guest.cookie, token);
		expect(accepted.ok).toBe(true);

		// La invitación queda aceptada y el alta existe, con el rol `member`.
		const invitation = await prisma.invitation.findUniqueOrThrow({ where: { token } });
		expect(invitation.status).toBe('accepted');
		const memberRole = await prisma.role.findFirstOrThrow({
			where: { contextType: 'organization', contextId: familyId, name: FAMILY_MEMBER_ROLE }
		});
		const membership = await prisma.member.findFirstOrThrow({
			where: { contextId: familyId, userId: guest.userId }
		});
		expect(membership.roleId).toBe(memberRole.id);

		// «La ve en su selector»: el listado del plugin (fuente de `/families`)
		// incluye la familia para la invitada.
		const list = await auth.handler(tenancyRequest('organization/list', guest.cookie));
		expect(list.ok).toBe(true);
		const { items } = (await list.json()) as { items: { id: string }[] };
		expect(items.map((organization) => organization.id)).toContain(familyId);
	});

	it('otra cuenta no puede aceptar la invitación ajena (hook 403)', async () => {
		const admin = await sessionCookieFor('Admin Celoso');
		const guest = await sessionCookieFor('Invitada Legal');
		const outsider = await sessionCookieFor('Cuenta Ajena');
		const { token } = await invitedToken(admin, guest.email);

		const stolen = await acceptViaApi(outsider.cookie, token);
		expect(stolen.status).toBe(403);
		expect(await stolen.text()).toContain('Invitation is not for this account');

		// Nada cambió: ni alta ni estado.
		const invitation = await prisma.invitation.findUniqueOrThrow({ where: { token } });
		expect(invitation.status).toBe('pending');
		expect(await prisma.member.findFirst({ where: { userId: outsider.userId } })).toBeNull();
	});

	it('una invitación ya aceptada no se puede aceptar dos veces', async () => {
		const admin = await sessionCookieFor('Admin Doble');
		const guest = await sessionCookieFor('Invitada Repetida');
		const { familyId, token } = await invitedToken(admin, guest.email);

		expect((await acceptViaApi(guest.cookie, token)).ok).toBe(true);
		const second = await acceptViaApi(guest.cookie, token);
		expect(second.status).toBe(400);

		// Y el alta no se duplicó (constraint `member` + idempotencia del hook).
		const memberships = await prisma.member.findMany({
			where: { contextId: familyId, userId: guest.userId }
		});
		expect(memberships).toHaveLength(1);
	});

	it('una invitación caducada no se puede aceptar', async () => {
		const admin = await sessionCookieFor('Admin Tardío');
		const guest = await sessionCookieFor('Invitada Tardía');
		const { token } = await invitedToken(admin, guest.email);

		await prisma.invitation.update({
			where: { token },
			data: { expiresAt: new Date(Date.now() - 1000) }
		});

		const expired = await acceptViaApi(guest.cookie, token);
		expect(expired.status).toBe(400);
		expect(await expired.text()).toContain('expired');

		const invitation = await prisma.invitation.findUniqueOrThrow({ where: { token } });
		expect(invitation.status).toBe('pending');
	});

	it('rechazar marca la invitación y no da de alta a nadie', async () => {
		const admin = await sessionCookieFor('Admin Rechazado');
		const guest = await sessionCookieFor('Invitada Que Rechaza');
		const { familyId, token } = await invitedToken(admin, guest.email);

		const rejected = await rejectViaApi(guest.cookie, token);
		expect(rejected.ok).toBe(true);

		const invitation = await prisma.invitation.findUniqueOrThrow({ where: { token } });
		expect(invitation.status).toBe('rejected');
		expect(
			await prisma.member.findFirst({ where: { contextId: familyId, userId: guest.userId } })
		).toBeNull();
	});
});

/**
 * Gestionar miembros (issue #62): listar, expulsar, abandonar, promover y
 * borrar la familia. Las llamadas van por las funciones de
 * `$lib/server/families.ts` (las mismas que usan los form actions), así que
 * los guards reales de los hooks (`tenancy.ts`) están en el camino.
 */
describe('expulsar, abandonar, promover y borrar (#62)', () => {
	/** Evento con sesión para las funciones de `$lib/server/families.ts`. */
	function eventOf(cookie: string, userId?: string): RequestEvent {
		return {
			request: new Request(BASE, { headers: { cookie } }),
			locals: { user: userId ? { id: userId } : undefined }
		} as unknown as RequestEvent;
	}

	/** Crea familia y devuelve su id (el creador queda de admin). */
	async function createFamilyFor(cookie: string): Promise<string> {
		const created = await createFamilyViaApi(cookie, `Familia Gestion ${randomUUID().slice(0, 8)}`);
		expect(created.ok).toBe(true);
		const { id } = (await created.json()) as { id: string };
		return id;
	}

	/** Crea usuario con sesión y lo da de alta en la familia con ese rol. */
	async function addSessionMember(
		familyId: string,
		roleName: typeof FAMILY_ADMIN_ROLE | typeof FAMILY_MEMBER_ROLE = FAMILY_MEMBER_ROLE
	): Promise<{ cookie: string; userId: string; email: string; memberId: string }> {
		const session = await sessionCookieFor('Miembro De Gestion');
		const role = await prisma.role.findFirstOrThrow({
			where: { contextType: 'organization', contextId: familyId, name: roleName }
		});
		const membership = await prisma.member.create({
			data: {
				id: randomUUID(),
				contextType: 'organization',
				contextId: familyId,
				userId: session.userId,
				roleId: role.id,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		});
		return { ...session, memberId: membership.id };
	}

	it('la vista de gestión muestra los miembros con su rol y el viewer en el suyo', async () => {
		const admin = await sessionCookieFor('Admin Gestion');
		const familyId = await createFamilyFor(admin.cookie);
		const member = await addSessionMember(familyId);

		const view = await familyDetailView(eventOf(admin.cookie, admin.userId), familyId);
		expect(view?.name).toContain('Familia Gestion');
		expect(view?.viewer).toEqual({ memberId: expect.any(String), isAdmin: true });
		expect(view?.members).toHaveLength(2);

		const memberRow = view?.members.find((row) => row.id === member.memberId);
		expect(memberRow?.isAdmin).toBe(false);
		expect(memberRow?.email).toBe(member.email);
	});

	it('un miembro se ve sin admin; quien no pertenece no ve nada', async () => {
		const admin = await sessionCookieFor('Admin Vista');
		const familyId = await createFamilyFor(admin.cookie);
		const member = await addSessionMember(familyId);

		const memberView = await familyDetailView(eventOf(member.cookie, member.userId), familyId);
		expect(memberView?.viewer).toEqual({ memberId: member.memberId, isAdmin: false });

		const outsider = await sessionCookieFor('Ajeno Vista');
		expect(await familyDetailView(eventOf(outsider.cookie, outsider.userId), familyId)).toBeNull();
	});

	it('el admin expulsa a un miembro', async () => {
		const admin = await sessionCookieFor('Admin Expulsador');
		const familyId = await createFamilyFor(admin.cookie);
		const member = await addSessionMember(familyId);

		await removeFamilyMember(eventOf(admin.cookie), member.memberId);
		expect(await prisma.member.findUnique({ where: { id: member.memberId } })).toBeNull();
	});

	it('un miembro no puede expulsar a otro (403 del guard)', async () => {
		const admin = await sessionCookieFor('Admin Celoso');
		const familyId = await createFamilyFor(admin.cookie);
		const member = await addSessionMember(familyId);
		const other = await addSessionMember(familyId);

		await expect(removeFamilyMember(eventOf(member.cookie), other.memberId)).rejects.toThrow(
			/Missing permission: member:remove/
		);
		expect(await prisma.member.findUnique({ where: { id: other.memberId } })).not.toBeNull();
	});

	it('expulsar a quien ya no está da el error tipado (404)', async () => {
		const admin = await sessionCookieFor('Admin Tardío');
		const familyId = await createFamilyFor(admin.cookie);
		const member = await addSessionMember(familyId);
		await removeFamilyMember(eventOf(admin.cookie), member.memberId);

		await expect(removeFamilyMember(eventOf(admin.cookie), member.memberId)).rejects.toBeInstanceOf(
			FamilyMemberGoneError
		);
	});

	it('un miembro puede abandonar por sí mismo', async () => {
		const admin = await sessionCookieFor('Admin Anfitrión');
		const familyId = await createFamilyFor(admin.cookie);
		const member = await addSessionMember(familyId);

		await leaveFamily(eventOf(member.cookie), member.memberId);
		expect(await prisma.member.findUnique({ where: { id: member.memberId } })).toBeNull();
	});

	it('el último admin no puede abandonar; promoviendo a otro, sí', async () => {
		const admin = await sessionCookieFor('Admin Último');
		const familyId = await createFamilyFor(admin.cookie);
		const member = await addSessionMember(familyId);
		const adminMembership = await prisma.member.findFirstOrThrow({
			where: { contextId: familyId, userId: admin.userId }
		});

		await expect(leaveFamily(eventOf(admin.cookie), adminMembership.id)).rejects.toBeInstanceOf(
			FamilyLastAdminError
		);
		expect(await prisma.member.findUnique({ where: { id: adminMembership.id } })).not.toBeNull();

		// «Debe promover a otro»: promovido el miembro, el admin original sale.
		await promoteFamilyMember(eventOf(admin.cookie), familyId, member.memberId);
		const promoted = await prisma.member.findUniqueOrThrow({
			where: { id: member.memberId },
			include: { role: true }
		});
		expect(promoted.role?.name).toBe(FAMILY_ADMIN_ROLE);

		await leaveFamily(eventOf(admin.cookie), adminMembership.id);
		expect(await prisma.member.findUnique({ where: { id: adminMembership.id } })).toBeNull();
	});

	it('promover exige admin (403) y asigna el rol admin de esa familia', async () => {
		const admin = await sessionCookieFor('Admin Promotor');
		const familyId = await createFamilyFor(admin.cookie);
		const member = await addSessionMember(familyId);

		await expect(
			promoteFamilyMember(eventOf(member.cookie), familyId, member.memberId)
		).rejects.toThrow(/Missing permission: member:update/);

		await promoteFamilyMember(eventOf(admin.cookie), familyId, member.memberId);
		const promoted = await prisma.member.findUniqueOrThrow({
			where: { id: member.memberId },
			include: { role: true }
		});
		expect(promoted.role?.name).toBe(FAMILY_ADMIN_ROLE);
	});

	it('borrar la familia se lleva familia, miembros, roles, statements e invitaciones', async () => {
		const admin = await sessionCookieFor('Admin Borrador');
		const familyId = await createFamilyFor(admin.cookie);
		await addSessionMember(familyId);

		// Una invitación pendiente también desaparece con la familia.
		const guestEmail = `borrada-${randomUUID().slice(0, 8)}@example.com`;
		await inviteFamily(eventOf(admin.cookie), { familyId, email: guestEmail });
		expect(await prisma.invitation.findFirst({ where: { contextId: familyId } })).not.toBeNull();

		await deleteFamily(eventOf(admin.cookie), familyId);

		expect(await prisma.organization.findUnique({ where: { id: familyId } })).toBeNull();
		expect(await prisma.member.findMany({ where: { contextId: familyId } })).toHaveLength(0);
		expect(await prisma.role.findMany({ where: { contextId: familyId } })).toHaveLength(0);
		expect(
			await prisma.roleStatement.findMany({ where: { role: { contextId: familyId } } })
		).toHaveLength(0);
		expect(await prisma.invitation.findMany({ where: { contextId: familyId } })).toHaveLength(0);
	});

	it('un miembro sin rol admin no puede borrar la familia (403)', async () => {
		const admin = await sessionCookieFor('Admin Superviviente');
		const familyId = await createFamilyFor(admin.cookie);
		const member = await addSessionMember(familyId);

		await expect(deleteFamily(eventOf(member.cookie), familyId)).rejects.toThrow(
			/Missing permission: organization:delete/
		);
		expect(await prisma.organization.findUnique({ where: { id: familyId } })).not.toBeNull();
	});
});
