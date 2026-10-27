import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// `family-context.ts` usa el cliente Prisma (perezoso, pero cualquier acceso lo
// instancia y exigiría DATABASE_URL). Este spec prueba la lógica de resolución,
// no la base: el módulo se sustituye por mocks con la forma que se consulta
// (`member.findMany`, `member.findFirst`, `organization.findUnique`).
const prisma = vi.hoisted(() => ({
	member: { findMany: vi.fn(), findFirst: vi.fn() },
	organization: { findUnique: vi.fn() }
}));
vi.mock('$lib/server/prisma.js', () => ({ default: prisma }));

import {
	ACTIVE_FAMILY_COOKIE,
	handleFamilyContext,
	requireActiveFamily,
	resolveActiveFamily,
	switchActiveFamily
} from './family-context.js';

/**
 * Stub de `RequestEvent` con un tarro de cookies real (mapa) y espías en
 * `set`/`delete`, para poder asertar qué cookie se escribe y con qué opciones.
 */
function eventOf(options: {
	user?: { id: string };
	cookies?: Record<string, string>;
	activeFamily?: { id: string; name: string } | null;
}): { event: RequestEvent; cookieSet: Mock; cookieDelete: Mock } {
	const jar = new Map(Object.entries(options.cookies ?? {}));
	const cookieSet = vi.fn((name: string, value: string) => {
		jar.set(name, value);
	});
	const cookieDelete = vi.fn((name: string) => {
		jar.delete(name);
	});
	const event = {
		locals: { user: options.user, activeFamily: options.activeFamily },
		cookies: {
			get: (name: string) => jar.get(name),
			set: cookieSet,
			delete: cookieDelete
		}
	} as unknown as RequestEvent;
	return { event, cookieSet, cookieDelete };
}

/** Membresía de familia como la devuelve `member.findMany`. */
const membershipOf = (contextId: string) => ({ contextId });

beforeEach(() => {
	vi.clearAllMocks();
});

describe('resolveActiveFamily', () => {
	it('sin sesión no consulta nada y devuelve null', async () => {
		const { event } = eventOf({});

		expect(await resolveActiveFamily(event)).toBeNull();
		expect(prisma.member.findMany).not.toHaveBeenCalled();
	});

	it('sin ninguna familia devuelve null', async () => {
		const { event } = eventOf({ user: { id: 'u1' } });
		prisma.member.findMany.mockResolvedValue([]);

		expect(await resolveActiveFamily(event)).toBeNull();
	});

	it('con cookie de una familia donde ES miembro devuelve esa familia', async () => {
		const { event } = eventOf({
			user: { id: 'u1' },
			cookies: { [ACTIVE_FAMILY_COOKIE]: 'f1' }
		});
		prisma.member.findMany.mockResolvedValue([membershipOf('f1'), membershipOf('f2')]);
		prisma.organization.findUnique.mockResolvedValue({ id: 'f1', name: 'Los Pérez' });

		expect(await resolveActiveFamily(event)).toEqual({ id: 'f1', name: 'Los Pérez' });
		expect(prisma.organization.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 'f1' } })
		);
	});

	it('la cookie no se confía: apuntar a una familia ajena la descarta y la limpia', async () => {
		// El usuario es miembro de dos familias, pero NINGUNA es la `f-ajena` de
		// la cookie (forjada a mano): sin contexto y sin arrastrar la cookie.
		const { event, cookieDelete } = eventOf({
			user: { id: 'u1' },
			cookies: { [ACTIVE_FAMILY_COOKIE]: 'f-ajena' }
		});
		prisma.member.findMany.mockResolvedValue([membershipOf('f1'), membershipOf('f2')]);

		expect(await resolveActiveFamily(event)).toBeNull();
		expect(cookieDelete).toHaveBeenCalledWith(ACTIVE_FAMILY_COOKIE, { path: '/' });
	});

	it('con una sola familia la selecciona automáticamente y fija la cookie', async () => {
		const { event, cookieSet } = eventOf({ user: { id: 'u1' } });
		prisma.member.findMany.mockResolvedValue([membershipOf('f1')]);
		prisma.organization.findUnique.mockResolvedValue({ id: 'f1', name: 'Los Pérez' });

		expect(await resolveActiveFamily(event)).toEqual({ id: 'f1', name: 'Los Pérez' });
		expect(cookieSet).toHaveBeenCalledWith(
			ACTIVE_FAMILY_COOKIE,
			'f1',
			expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'lax' })
		);
	});

	it('la selección automática también arregla una cookie huérfana', async () => {
		// Expulsado de la `f-vieja`, le queda una sola: pasa a ser la activa.
		const { event, cookieSet } = eventOf({
			user: { id: 'u1' },
			cookies: { [ACTIVE_FAMILY_COOKIE]: 'f-vieja' }
		});
		prisma.member.findMany.mockResolvedValue([membershipOf('f1')]);
		prisma.organization.findUnique.mockResolvedValue({ id: 'f1', name: 'Los Pérez' });

		expect(await resolveActiveFamily(event)).toEqual({ id: 'f1', name: 'Los Pérez' });
		expect(cookieSet).toHaveBeenCalledWith(ACTIVE_FAMILY_COOKIE, 'f1', expect.anything());
	});

	it('con varias familias y sin elección devuelve null (elige el selector, #64)', async () => {
		const { event, cookieSet } = eventOf({ user: { id: 'u1' } });
		prisma.member.findMany.mockResolvedValue([membershipOf('f1'), membershipOf('f2')]);

		expect(await resolveActiveFamily(event)).toBeNull();
		expect(cookieSet).not.toHaveBeenCalled();
	});

	it('con cookie válida pero familia borrada entre medias devuelve null', async () => {
		const { event } = eventOf({
			user: { id: 'u1' },
			cookies: { [ACTIVE_FAMILY_COOKIE]: 'f1' }
		});
		// Carrera imposible (el plugin borra los miembros en cascada), pero la
		// resolución no se rompe: la cookie huérfana se limpiará en la siguiente.
		prisma.member.findMany.mockResolvedValue([membershipOf('f1')]);
		prisma.organization.findUnique.mockResolvedValue(null);

		expect(await resolveActiveFamily(event)).toBeNull();
	});
});

describe('handleFamilyContext', () => {
	it('con sesión deja la familia resuelta en locals y resuelve la petición', async () => {
		const { event } = eventOf({ user: { id: 'u1' } });
		prisma.member.findMany.mockResolvedValue([membershipOf('f1')]);
		prisma.organization.findUnique.mockResolvedValue({ id: 'f1', name: 'Los Pérez' });
		const resolve = vi.fn(async () => new Response('ok'));

		const response = await handleFamilyContext({ event, resolve });

		expect(event.locals.activeFamily).toEqual({ id: 'f1', name: 'Los Pérez' });
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(await response.text()).toBe('ok');
	});

	it('sin sesión resuelve la petición sin tocar la base de datos', async () => {
		const { event } = eventOf({});
		const resolve = vi.fn(async () => new Response('ok'));

		await handleFamilyContext({ event, resolve });

		expect(event.locals.activeFamily).toBeUndefined();
		expect(prisma.member.findMany).not.toHaveBeenCalled();
		expect(resolve).toHaveBeenCalledTimes(1);
	});
});

describe('requireActiveFamily', () => {
	it('devuelve la familia activa ya resuelta en locals', () => {
		const { event } = eventOf({
			activeFamily: { id: 'f1', name: 'Los Pérez' }
		});

		expect(requireActiveFamily(event)).toEqual({ id: 'f1', name: 'Los Pérez' });
	});

	it('sin familia activa redirige a /families (crear familia)', async () => {
		const { event } = eventOf({ activeFamily: null });

		// `redirect()` lanza un `Redirect` de SvelteKit; lo capturamos a mano.
		let thrown: { status?: number; location?: string } | undefined;
		try {
			requireActiveFamily(event);
		} catch (error) {
			thrown = error as { status?: number; location?: string };
		}

		expect(thrown?.status).toBe(302);
		expect(thrown?.location).toBe('/families');
	});
});

describe('switchActiveFamily', () => {
	it('siendo miembro fija la cookie y confirma el cambio', async () => {
		const { event, cookieSet } = eventOf({ user: { id: 'u1' } });
		prisma.member.findFirst.mockResolvedValue({ id: 'm1' });

		expect(await switchActiveFamily(event, 'f2')).toBe(true);
		expect(prisma.member.findFirst).toHaveBeenCalledWith({
			where: { userId: 'u1', contextType: 'organization', contextId: 'f2' },
			select: { id: true }
		});
		expect(cookieSet).toHaveBeenCalledWith(ACTIVE_FAMILY_COOKIE, 'f2', expect.anything());
	});

	it('sin pertenencia a esa familia no toca la cookie y lo deniega', async () => {
		const { event, cookieSet } = eventOf({ user: { id: 'u1' } });
		prisma.member.findFirst.mockResolvedValue(null);

		expect(await switchActiveFamily(event, 'f-ajena')).toBe(false);
		expect(cookieSet).not.toHaveBeenCalled();
	});

	it('sin sesión ni id no hay nada que cambiar', async () => {
		const { event } = eventOf({});

		expect(await switchActiveFamily(event, 'f1')).toBe(false);
		expect(prisma.member.findFirst).not.toHaveBeenCalled();
	});
});
