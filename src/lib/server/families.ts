import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import type { InvitationStatus } from '@zytera/better-auth-tenancy';
import { APIError } from 'better-auth/api';

import { auth } from '$lib/server/auth.js';
import prisma from '$lib/server/prisma.js';
import {
	FAMILY_ADMIN_ROLE,
	FAMILY_MEMBER_ROLE,
	MAX_FAMILIES_PER_USER,
	MAX_FAMILY_MEMBERS,
	isAlreadyFamilyMember,
	isFamilyInvitationPending,
	isFamilyLimitReached,
	isFamilyMembersLimitReached,
	isInvitationNotForAccount
} from '$lib/server/tenancy.js';

/** Familia con los campos que la UI necesita (el plugin devuelve más). */
export interface Family {
	id: string;
	name: string;
	/** ¿Puede el usuario de la sesión invitar en esta familia? (solo admin, #60). */
	canInvite: boolean;
}

/** El usuario ya pertenece a `FAMILIES_MAX` familias: no puede crear otra. */
export class FamilyLimitReachedError extends Error {
	constructor() {
		super(`Max ${MAX_FAMILIES_PER_USER} families per user`);
		this.name = 'FamilyLimitReachedError';
	}
}

/** Tope de familias por usuario, para los mensajes de la UI. */
export const FAMILIES_MAX = MAX_FAMILIES_PER_USER;

/** La familia ya tiene `FAMILY_MEMBERS_MAX` miembros: no caben más invitados. */
export class FamilyMemberLimitReachedError extends Error {
	constructor() {
		super(`Max ${MAX_FAMILY_MEMBERS} members per family`);
		this.name = 'FamilyMemberLimitReachedError';
	}
}

/** Tope de miembros por familia, para los mensajes de la UI. */
export const FAMILY_MEMBERS_MAX = MAX_FAMILY_MEMBERS;

/** Ya se invitó a este email y la invitación sigue pendiente de respuesta. */
export class FamilyInvitationPendingError extends Error {
	constructor(public readonly email: string) {
		super(`Pending invitation for ${email}`);
		this.name = 'FamilyInvitationPendingError';
	}
}

/** El email invitado ya pertenece a la familia (no se puede invitar dos veces). */
export class AlreadyFamilyMemberError extends Error {
	constructor(public readonly email: string) {
		super(`Already a member: ${email}`);
		this.name = 'AlreadyFamilyMemberError';
	}
}

/**
 * La invitación ya no puede responderse: usada, cancelada, caducada o
 * directamente inexistente (checklist #61 «invitación expirada o ya usada»).
 * Cubre los 400/404 del plugin al aceptar o rechazar.
 */
export class FamilyInvitationUnavailableError extends Error {
	constructor() {
		super('Family invitation is no longer available');
		this.name = 'FamilyInvitationUnavailableError';
	}
}

/** La sesión con la que se intenta responder no es la del email invitado. */
export class FamilyInvitationNotForAccountError extends Error {
	constructor(public readonly email: string) {
		super(`Invitation is not for this account: ${email}`);
		this.name = 'FamilyInvitationNotForAccountError';
	}
}

/**
 * Las familias del usuario, vía el endpoint del plugin: su hook de filtrado
 * (ver `$lib/server/tenancy.ts`) deja sólo aquellas donde el usuario es miembro,
 * que es justo la «lista de familias» del criterio de aceptación.
 *
 * Las cabeceras de la petición llevan la cookie de sesión (identidad) y el
 * Accept-Language (los mensajes de error del plugin salen ya en el idioma del
 * usuario), que es todo lo que el endpoint necesita.
 */
export async function listFamilies(event: RequestEvent): Promise<Family[]> {
	// `query: {}` es solo tipado (el plugin declara el objeto query como
	// requerido aunque todos sus campos sean opcionales; ver
	// Zytera/better-auth-tenancy#26): sin orden explícito vale lo que dé el plugin.
	const { items } = await auth.api.listOrganizations({
		headers: event.request.headers,
		query: {}
	});

	// Quién puede invitar en cada familia (#60): solo el admin, y lo dice su
	// membresía con rol admin. Los ids de familias administradas vienen de una
	// única consulta con el join member→role; el resto son solo miembros.
	const user = event.locals.user;
	if (!user) return [];
	const adminMemberships = await prisma.member.findMany({
		where: {
			userId: user.id,
			contextType: 'organization',
			role: { name: FAMILY_ADMIN_ROLE }
		},
		select: { contextId: true }
	});
	const adminFamilyIds = new Set(adminMemberships.map((membership) => membership.contextId));

	return items.map(({ id, name }) => ({ id, name, canInvite: adminFamilyIds.has(id) }));
}

/**
 * Crea la familia vía el plugin. Además de la organización, su
 * `onEntityCreated` (en `$lib/server/tenancy.ts`) siembra los roles y da de
 * alta al creador como admin; si eso falla, el plugin deshace la creación y
 * aquí llega el error: no hay familia a medias.
 *
 * Si el usuario ya alcanza el tope (`MAX_FAMILIES_PER_USER`, guardado en el
 * hook `organization/create` del plugin), lanza `FamilyLimitReachedError` para
 * que el formulario pueda dar un mensaje concreto y no el genérico.
 *
 * `metadata: undefined` es solo tipado, no semántica: el zod del endpoint lo
 * tiene opcional, pero el tipo de entrada del plugin (3.2.2) lo declara
 * requerido (ver Zytera/better-auth-tenancy#26).
 */
export async function createFamily(
	event: RequestEvent,
	family: { name: string; slug: string }
): Promise<void> {
	try {
		await auth.api.createOrganization({
			body: { ...family, metadata: undefined },
			headers: event.request.headers
		});
	} catch (error) {
		if (isFamilyLimitReached(error)) {
			throw new FamilyLimitReachedError();
		}
		throw error;
	}
}

/**
 * Invita por email a la familia (issue #60): crea la invitación vía el plugin
 * con el rol básico (`member`), y su hook `invitation/create` envía el correo
 * con el token (ver `$lib/server/tenancy.ts` y `invitations.ts`).
 *
 * Si falla el envío, el propio plugin deshace la invitación y el error sube
 * hasta aquí: no quedan invitaciones registradas sin correo enviado.
 *
 * Las validaciones de duplicados y tope (checklist #60) viven en los hooks de
 * `tenancy.ts` — miembro existente y familia llena— y en el propio plugin
 * —invitación pendiente duplicada—; aquí solo se traducen a errores tipados
 * para que la acción del formulario dé a cada uno su mensaje concreto.
 */
export async function inviteFamily(
	event: RequestEvent,
	{ familyId, email }: { familyId: string; email: string }
): Promise<void> {
	// El email se normaliza aquí, además de en el hook del plugin: mejor una
	// invitación guardada ya minúscula que depender del body del formulario.
	const identifier = email.trim().toLowerCase();
	try {
		// Rol `member` de la familia (lo siembra `onEntityCreated` con cada
		// familia): la invitación nace ya con el rol de entrada de la #60. Si no
		// existiera (familia a medio sembrar), `roleId: undefined` hace que el
		// plugin la guarde sin rol y la aceptación fallará de forma visible.
		const memberRole = await prisma.role.findFirst({
			where: {
				contextType: 'organization',
				contextId: familyId,
				name: FAMILY_MEMBER_ROLE
			},
			select: { id: true }
		});

		await auth.api.createInvitation({
			body: {
				identifier,
				contextType: 'organization',
				contextId: familyId,
				roleId: memberRole?.id,
				// `metadata: undefined` es solo tipado, igual que en `createFamily`:
				// el tipo de entrada del plugin (3.2.2) lo declara requerido aunque
				// el zod del endpoint lo tenga opcional (ver
				// Zytera/better-auth-tenancy#26).
				metadata: undefined
			},
			headers: event.request.headers
		});
	} catch (error) {
		if (isAlreadyFamilyMember(error)) {
			throw new AlreadyFamilyMemberError(identifier);
		}
		if (isFamilyMembersLimitReached(error)) {
			throw new FamilyMemberLimitReachedError();
		}
		if (isFamilyInvitationPending(error)) {
			throw new FamilyInvitationPendingError(identifier);
		}
		throw error;
	}
}

/**
 * Vista de una invitación de familia por token: lo que la página
 * `/invitations/[token]` muestra (issues #60 y #61). `null` si el token no
 * existe, no es de una familia (los teams no tienen vista) o la familia ya no
 * existe: en todos esos casos la página da la invitación por inválida.
 *
 * Una invitación `pending` pero con `expiresAt` pasado se devuelve como
 * `expired`: el cron de cleanup marcará el estado en la base, pero el invitado
 * no tiene por qué esperar a ese barrido para ver el estado real.
 */
export interface FamilyInvitationView {
	status: InvitationStatus;
	identifier: string | null;
	familyName: string;
	/** Nombre visible de quien invita (su nombre, o su email a falta de él). */
	invitedBy: string;
}

export async function familyInvitationView(token: string): Promise<FamilyInvitationView | null> {
	const invitation = await prisma.invitation.findUnique({
		where: { token },
		select: {
			status: true,
			identifier: true,
			expiresAt: true,
			contextType: true,
			contextId: true,
			invitedByUser: { select: { name: true, email: true } }
		}
	});

	// Solo las invitaciones a familias tienen vista en la app (los teams no se
	// usan), y siempre cuelgan de una organización viva.
	if (!invitation || invitation.contextType !== 'organization') {
		return null;
	}
	const family = await prisma.organization.findUnique({
		where: { id: invitation.contextId },
		select: { name: true }
	});
	if (!family) {
		return null;
	}

	// Pendiente y caducada: ver comentario de `FamilyInvitationView`.
	const expired =
		invitation.status === 'pending' &&
		invitation.expiresAt !== null &&
		invitation.expiresAt < new Date();

	return {
		// El modelo solo guarda los estados de `InvitationStatus` (los escribe
		// el plugin); el `as` solo recupera el literal tras venir de Prisma.
		status: (expired ? 'expired' : invitation.status) as InvitationStatus,
		identifier: invitation.identifier,
		familyName: family.name,
		invitedBy: invitation.invitedByUser?.name?.trim() || invitation.invitedByUser?.email || ''
	};
}

/**
 * Traduce los errores del plugin al aceptar o rechazar en los tipados de la
 * UI. Los 400/404 del endpoint (invitación inexistente, ya usada, caducada…
 * ver `canUseInvitation` del plugin) son todos «ya no disponible»: la página
 * ya solo ofrece responder sobre una `pending` vigente, así que aquí solo
 * llegan por carrera con otro dispositivo o con la UI rancia.
 */
function invitationResponseError(error: unknown): Error | undefined {
	if (isFamilyMembersLimitReached(error)) {
		// La familia se llenó desde que se envió la invitación: el alta la
		// deshizo `onInvitationAccepted` y la invitación sigue pendiente.
		return new FamilyMemberLimitReachedError();
	}
	if (isInvitationNotForAccount(error)) {
		// El hook `invitation/accept`/`decline` (`tenancy.ts`) no vio el email
		// de la sesión entre los invitados.
		return new FamilyInvitationNotForAccountError('');
	}
	if (
		error instanceof APIError &&
		(error.status === 'BAD_REQUEST' || error.status === 'NOT_FOUND')
	) {
		return new FamilyInvitationUnavailableError();
	}
	return undefined;
}

/**
 * Acepta la invitación (issue #61): el plugin marca la invitación como
 * aceptada y `actions.onInvitationAccepted` (`tenancy.ts`) da de alta al
 * invitado como miembro con el rol de la invitación. Autorización (sesión con
 * el email invitado) y validaciones de estado las aplican los hooks del
 * endpoint; aquí solo se traducen los fallos para la UI.
 *
 * Al éxito, el invitado es miembro y ve la familia en su selector (criterio
 * de aceptación: `listFamilies` la lista por pertenencia).
 */
export async function acceptFamilyInvitation(event: RequestEvent, token: string): Promise<void> {
	try {
		await auth.api.acceptInvitation({ body: { token }, headers: event.request.headers });
	} catch (error) {
		const mapped = invitationResponseError(error);
		if (mapped) throw mapped;
		throw error;
	}
}

/** Rechaza la invitación (issue #61): la marca como `rejected` y no hay alta. */
export async function rejectFamilyInvitation(event: RequestEvent, token: string): Promise<void> {
	try {
		await auth.api.rejectInvitation({ body: { token }, headers: event.request.headers });
	} catch (error) {
		const mapped = invitationResponseError(error);
		if (mapped) throw mapped;
		throw error;
	}
}

/**
 * Deriva el `slug` de una familia a partir de su nombre.
 *
 * El plugin de tenancy exige un `slug` único con formato `^[a-z0-9-]+$` y
 * máximo 50 caracteres, pero la UI (issue #58) sólo pide el nombre: el slug es
 * un identificador técnico que el usuario nunca ve, así que se fabrica aquí.
 *
 * Se añade siempre un sufijo aleatorio en vez de intentar el slug limpio y
 * reintentar si existe: «colisión imposible en la práctica» sin bucles ni
 * errores de slug que traducir. Es el mismo trato que dan Notion o Linear a sus
 * ids cortos.
 *
 * @param name   Nombre de la familia, ya validado (no vacío).
 * @param suffix Sufijo aleatorio inyectable para los tests (6 hex por defecto).
 * @returns Slug normalizado, siempre válido para el plugin.
 */
export function familySlug(name: string, suffix: string = newSlugSuffix()): string {
	// Hueco para el sufijo y su guion: el techo de 50 lo pone el plugin.
	const base = slugify(name)
		.slice(0, 50 - suffix.length - 1)
		.replace(/-+$/, '');

	// Un nombre sin material slugueable («¿?¡!») no puede dejar el slug vacío.
	const stem = base.length > 0 ? base : 'familia';
	return `${stem}-${suffix}`;
}

/** Minúsculas, sin diacríticos y todo lo no alfanumérico a guion. */
function slugify(name: string): string {
	return name
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function newSlugSuffix(): string {
	// Hex minúsculas: cumple el formato del slug sin normalizar nada más.
	return randomUUID().replaceAll('-', '').slice(0, 6);
}
