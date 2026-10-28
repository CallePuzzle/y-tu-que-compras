import type { GenericEndpointContext } from '@better-auth/core';
import type { InvitationCreatedEvent } from '@zytera/better-auth-tenancy';
import { getRequestEvent } from '$app/server';
import { APIError } from 'better-auth/api';
import { env } from '$env/dynamic/private';

import type { Locale } from '$lib/paraglide/runtime.js';
import { extractLocaleFromRequest } from '$lib/paraglide/runtime.js';
import { sendFamilyInvitationEmail } from './emails.js';
import logger from './logger.js';

/**
 * Ruta (en inglés, como todas las URLs) de la vista de una invitación por
 * token. El enlace del correo apunta aquí: sin sesión, la propia vista manda
 * al login con el email prefijado (`?email=`) y vuelve tras autenticarse, donde
 * se acepta o rechaza (issue #61).
 */
export const INVITATION_PATHNAME = '/invitations';

/** Enlace absoluto de una invitación, a partir del token. */
export function invitationUrl(token: string): string {
	// `BETTER_AUTH_URL` es el origen público de la app (el mismo que better-auth
	// usa como baseURL), así que es también el del enlace del correo.
	const base = env.BETTER_AUTH_URL ?? env.ORIGIN ?? 'http://localhost:5173';
	return new URL(`${INVITATION_PATHNAME}/${encodeURIComponent(token)}`, base).toString();
}

/**
 * Locale del correo: la del ADMIN que invita. El invitado puede no tener
 * cuenta todavía, así que su locale es desconocida.
 *
 * Se resuelve del REQUEST EVENT de SvelteKit con la misma estrategia que el
 * OTP (`$lib/server/auth.ts`): cookie del selector de idioma, Accept-Language
 * y base. Tiene que ser el evento de SvelteKit y no `ctx.request` del
 * endpoint: `inviteFamily` llama a `auth.api.createInvitation` desde una
 * server action y en la llamada programática better-call deja
 * `ctx.request = undefined` — la cabecera llegaba vacía y el correo salía
 * siempre en español (issue #103).
 */
function invitationLocale(): Locale {
	return extractLocaleFromRequest(getRequestEvent().request);
}

/**
 * Envía el correo de invitación de una familia recién creada (hook
 * `actions.onInvitationCreated` del plugin de tenancy, que pasa el token de la
 * invitación justo para esto).
 *
 * Lanza si falla: el plugin deshace la invitación y el error sube al admin —
 * nunca hay invitación «enviada a medias» sin correo.
 */
export async function sendFamilyInvitationEmailFor(
	event: InvitationCreatedEvent,
	ctx: GenericEndpointContext
): Promise<void> {
	if (!event.identifier) {
		// Invitación sin email (enlaces/códigos QR): nada que enviar.
		logger.warn({ contextId: event.contextId }, 'Invitación sin email: no se envía correo');
		return;
	}

	const adapter = ctx.context.adapter;
	const [family, inviter] = await Promise.all([
		adapter.findOne<{ name: string }>({
			model: 'organization',
			where: [{ field: 'id', value: event.contextId }]
		}),
		adapter.findOne<{ name?: string | null; email?: string }>({
			model: 'user',
			where: [{ field: 'id', value: event.invitedBy }]
		})
	]);

	if (!family) {
		// Inalcanzable en la app (la invitación referencia una familia viva), pero
		// si pasara, la invitación no tiene sentido: el lanzamiento deshace la
		// creación en el plugin.
		throw new APIError('NOT_FOUND', { message: `Family not found: ${event.contextId}` });
	}

	await sendFamilyInvitationEmail({
		to: event.identifier,
		family: family.name,
		// Sin nombre visible, el email de quien invita (todo usuario lo tiene).
		inviter: inviter?.name?.trim() || inviter?.email || '',
		url: invitationUrl(event.token),
		locale: invitationLocale()
	});
}
