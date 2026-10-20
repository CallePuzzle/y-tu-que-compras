import { randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';

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
import { MAX_FAMILIES_PER_USER } from './tenancy.js';
import { familySlug } from './families.js';
import prisma from './prisma.js';

const BASE = 'http://localhost:4173/api/auth';

/** Crea un usuario real y devuelve la cabecera Cookie de su sesión. */
async function sessionCookieFor(name: string): Promise<string> {
	const userId = randomUUID();
	await prisma.user.create({
		data: {
			id: userId,
			name,
			email: `${userId}@integration.test`,
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
	const context = await auth.$context;
	const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
	await prisma.session.create({
		data: {
			id: randomUUID(),
			token,
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			userId
		}
	});

	const signature = await makeSignature(token, String(context.secret));
	// `useSecureCookies: !dev` y en vitest `dev` es true (`import.meta.env.DEV`):
	// la cookie va sin el prefijo `__Secure-`.
	return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
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
		const cookie = await sessionCookieFor('Creador');
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
		const cookie = await sessionCookieFor('Listador');
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
		const cookie = await sessionCookieFor('Topador');

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
		const cookie = await sessionCookieFor('Duplicado');
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
