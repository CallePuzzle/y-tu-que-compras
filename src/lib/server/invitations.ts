import type { GenericEndpointContext } from '@better-auth/core';
import type { InvitationCreatedEvent } from '@zytera/better-auth-tenancy';
import { APIError } from 'better-auth/api';
import { env } from '$env/dynamic/private';

import type { Locale } from '$lib/paraglide/runtime.js';
import { sendFamilyInvitationEmail } from './emails.js';
import logger from './logger.js';

/**
 * Ruta (en inglés, como todas las URLs) de la vista de una invitación por
 * token. El enlace del correo apunta aquí: el guard de sesión manda al
 * invitado sin sesión a `/login?redirectTo=...` y, tras autenticarse, vuelve a
 * esta página (aceptar/rechazar es la issue #61).
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
 * Locale del correo: el del ADMIN que invita (la cabecera `Accept-Language` de
 * su petición, la misma que el cliente del plugin manda). El invitado puede no
 * tener cuenta todavía, así que su locale es desconocido. Solo hay dos: `es`
 * por defecto, `en` si la cabecera lo pide.
 */
function localeFromRequest(ctx: GenericEndpointContext): Locale {
	const accept = ctx.request?.headers.get('accept-language') ?? '';
	return accept.trim().toLowerCase().startsWith('en') ? 'en' : 'es';
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
		locale: localeFromRequest(ctx)
	});
}
