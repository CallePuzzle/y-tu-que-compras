import { dev } from '$app/environment';
import { redirect, type Handle, type RequestEvent } from '@sveltejs/kit';

import prisma from '$lib/server/prisma.js';

// Contexto de familia activa (issue #63): resolver la familia del usuario en
// cada request. El plugin de tenancy no guarda organización activa en la
// sesión (ver el comentario de `tenancyConfig`), así que el estado viaja en una
// cookie httpOnly que NUNCA se confía: en cada request se verifica que el
// usuario siga siendo miembro de la familia que declara.
//
// El resultado vive en `event.locals.activeFamily` (lo deja `handleFamilyContext`,
// en la secuencia de `hooks.server.ts`) y las páginas lo consumen con
// `requireActiveFamily`. Los ids de familia que lleguen del cliente (forms,
// query, params) se usan solo tras comprobar membresía — así filtrarán también
// las queries de listas/despensa/historial cuando existan (issues #65, #72, #76).

/** Nombre de la cookie httpOnly con la familia activa (su id). */
export const ACTIVE_FAMILY_COOKIE = 'active-family';

/**
 * Un año: la elección persiste entre sesiones (criterio de la issue padre #40).
 * La expulsión o el borrado de la familia no dependen de esta caducidad: la
 * membresía se verifica en cada request y la cookie huérfana se limpia sola.
 */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** La familia activa que las páginas ven en `event.locals.activeFamily`. */
export interface ActiveFamily {
	id: string;
	/** Nombre visible, para que el selector (#64) y las cabeceras no reconsulten. */
	name: string;
}

/** Fija la cookie de familia activa. Llamar solo tras verificar membresía. */
function setActiveFamilyCookie(event: RequestEvent, familyId: string): void {
	event.cookies.set(ACTIVE_FAMILY_COOKIE, familyId, {
		httpOnly: true,
		sameSite: 'lax',
		// `useSecureCookies: !dev` de better-auth: mismo criterio, cookies sin
		// `Secure` en local para que el `http://` de desarrollo las guarde.
		secure: !dev,
		path: '/',
		maxAge: COOKIE_MAX_AGE_SECONDS
	});
}

function clearActiveFamilyCookie(event: RequestEvent): void {
	event.cookies.delete(ACTIVE_FAMILY_COOKIE, { path: '/' });
}

/**
 * Resuelve la familia activa del usuario de la sesión, o `null` si no hay:
 *
 * 1. Sin sesión no hay nada que resolver (el hook ni llega a llamar).
 * 2. La cookie vale solo si el usuario ES miembro de esa familia; una cookie
 *    huérfana (expulsado, familia borrada) se descarta y se limpia.
 * 3. Con una sola familia se selecciona sola y se persiste: no hay pregunta
 *    que hacer (checklist «selección automática»).
 * 4. Con varias familias y sin elección válida, `null`: quién elige es el
 *    selector (issue #64), y mientras tanto las páginas mandan a `/families`.
 */
export async function resolveActiveFamily(event: RequestEvent): Promise<ActiveFamily | null> {
	const user = event.locals.user;
	if (!user) return null;

	// Las membresías de familia del usuario, frescas en cada request: ES la
	// verificación de membresía del checklist (el id de la cookie es solo una
	// pista; la verdad está en la tabla `member`).
	const memberships = await prisma.member.findMany({
		where: { userId: user.id, contextType: 'organization' },
		select: { contextId: true }
	});
	if (memberships.length === 0) return null;

	const memberFamilyIds = new Set(memberships.map((membership) => membership.contextId));
	const cookieId = event.cookies.get(ACTIVE_FAMILY_COOKIE);
	let familyId = cookieId && memberFamilyIds.has(cookieId) ? cookieId : null;

	if (!familyId && cookieId) {
		// Cookie que apunta a una familia ajena o ya inexistente: fuera. La
		// re-selección (familia única) ocurre justo abajo.
		clearActiveFamilyCookie(event);
	}

	if (!familyId && memberships.length === 1) {
		// Selección automática: la única familia que tiene es la activa.
		familyId = memberships[0].contextId;
		setActiveFamilyCookie(event, familyId);
	}
	if (!familyId) return null;

	const family = await prisma.organization.findUnique({
		where: { id: familyId },
		select: { id: true, name: true }
	});
	// Inalcanzable en la práctica (el plugin borra los miembros en cascada con
	// la familia, así que no habría membresía que casara): si aun así ocurre,
	// devolver null basta — la cookie queda huérfana y se limpia en la
	// siguiente request.
	return family ? { id: family.id, name: family.name } : null;
}

/**
 * Helper de load para las páginas que trabajan sobre una familia (issue #63):
 * devuelve la familia activa que `handleFamilyContext` dejó en locals, o manda
 * a `/families` — donde se crean — cuando no hay ninguna o falta por elegir.
 *
 * Es también la puerta de entrada de las queries de listas, despensa e
 * historial: el id de familia que filtrará la consulta SIEMPRE sale de aquí
 * (contexto verificado en servidor), nunca del cliente sin comprobar.
 */
export function requireActiveFamily(event: RequestEvent): ActiveFamily {
	const family = event.locals.activeFamily;
	if (!family) {
		// 302 (y no 303): un load es GET; el navegador y el router lo siguen igual.
		redirect(302, '/families');
	}
	return family;
}

/**
 * Cambia la familia activa (lo usará el selector de la issue #64): comprueba
 * la membresía ANTES de escribir la cookie — el id que llegue del cliente no
 * se confía — y devuelve `false` (sin tocar nada) si el usuario no pertenece a
 * esa familia. Con una membresía válida la cookie queda fijada y la siguiente
 * request ya resuelve ese contexto.
 */
export async function switchActiveFamily(event: RequestEvent, familyId: string): Promise<boolean> {
	const user = event.locals.user;
	if (!user || !familyId) return false;

	const membership = await prisma.member.findFirst({
		where: { userId: user.id, contextType: 'organization', contextId: familyId },
		select: { id: true }
	});
	if (!membership) return false;

	setActiveFamilyCookie(event, familyId);
	return true;
}

/**
 * Resuelve la familia activa UNA VEZ por request — loads, actions y
 * `+server.ts` la encuentran en `event.locals.activeFamily`. Va en la
 * secuencia justo tras `handleAuthGuard`: necesita el `locals.user` que deja
 * `betterAuthHandle` (y con él, las peticiones sin sesión —assets y rutas
 * públicas, que el handle de auth se salta— quedan fuera sin más comprobación).
 */
export const handleFamilyContext: Handle = async ({ event, resolve }) => {
	if (!event.locals.user) return resolve(event);

	event.locals.activeFamily = await resolveActiveFamily(event);
	return resolve(event);
};
