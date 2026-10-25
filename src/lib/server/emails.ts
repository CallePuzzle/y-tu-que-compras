import { m } from '$lib/paraglide/messages.js';

import type { Locale } from '$lib/paraglide/runtime.js';
import { sendEmail } from './sender.js';

export interface OtpEmailParams {
	to: string;
	otp: string;
	/** Por defecto, el locale del request (o `es`). */
	locale?: Locale;
}

// El codigo viaja en el asunto: es lo primero que se ve en la bandeja y en la
// notificacion del movil, sin ni siquiera abrir el correo.
export async function sendOtpEmail({ to, otp, locale }: OtpEmailParams): Promise<void> {
	await sendEmail({
		to,
		subject: m.email_otp_subject({ code: otp }, { locale }),
		text: m.email_otp_body({ code: otp }, { locale })
	});
}

export interface FamilyInvitationEmailParams {
	to: string;
	inviter: string;
	/** Nombre de la familia a la que se invita: da contexto al invitado. */
	family: string;
	url: string;
	/** Por defecto, el locale del request (o `es`). */
	locale?: Locale;
}

export async function sendFamilyInvitationEmail({
	to,
	inviter,
	family,
	url,
	locale
}: FamilyInvitationEmailParams): Promise<void> {
	await sendEmail({
		to,
		subject: m.email_invite_subject({ inviter, family }, { locale }),
		text: m.email_invite_body({ inviter, family, url }, { locale })
	});
}
