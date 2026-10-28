import { fail, redirect } from '@sveltejs/kit';
import { m } from '$lib/paraglide/messages.js';
import {
	FAMILIES_MAX,
	FAMILY_MEMBERS_MAX,
	FamilyInvitationNotForAccountError,
	FamilyInvitationUnavailableError,
	FamilyLimitReachedError,
	FamilyMemberLimitReachedError,
	acceptFamilyInvitation,
	familyInvitationView,
	rejectFamilyInvitation
} from '$lib/server/families.js';
import logger from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

/**
 * Vista de una invitación por token (el enlace del correo, issues #60 y #61).
 *
 * La ruta es pública a propósito (ver `isPublicPathname`): el token del enlace
 * es la credencial de la invitación, y el invitado sin cuenta debe poder VER
 * que su invitación existe — o que ya caducó — antes de crearse una. Por eso
 * el load distingue dos casos sin sesión:
 *
 * - Invitación vigente: al login, con `redirectTo` de vuelta aquí y el email
 *   del invitado prefijado (`?email=`, checklist #61).
 * - Invitación inexistente o gestionada: se muestra su estado en lectura; no
 *   hace falta autenticarse para leer «caducada».
 *
 * Responder (aceptar/rechazar) exige sesión siempre: los form actions lo
 * comprueban y los endpoints del plugin lo vuelven a exigir (hooks
 * `invitation/accept`/`decline` en `$lib/server/tenancy.ts`).
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
	const invitation = await familyInvitationView(params.token);

	if (!locals.user && invitation?.status === 'pending') {
		redirect(
			302,
			`/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}&email=${encodeURIComponent(invitation.identifier ?? '')}`
		);
	}

	// El email de la sesión solo puede responder la invitación que lleva su
	// dirección (checklist #61 «comprobar que el email de la sesión coincide»).
	const invitedEmail = invitation?.identifier?.trim().toLowerCase() ?? null;
	const sessionEmail = locals.user?.email.trim().toLowerCase() ?? null;

	return {
		invitation,
		viewer: locals.user
			? {
					email: locals.user.email,
					canRespond:
						invitation?.status === 'pending' &&
						invitedEmail !== null &&
						invitedEmail === sessionEmail
				}
			: null
	};
};

/**
 * Aceptar o rechazar (issue #61). Dos form actions sobre la misma página: el
 * token ya viaja en la URL, no hay más datos que pedirle al formulario.
 */
async function answer(event: Parameters<Actions[keyof Actions]>[0], response: 'accept' | 'reject') {
	const user = event.locals.user;
	// Alcanzable sin sesión solo a mano (la página no pinta los botones): al
	// login, con vuelta a la invitación.
	if (!user) {
		redirect(302, `/login?redirectTo=${encodeURIComponent(event.url.pathname)}`);
	}

	const token = event.params.token;
	const invitation = await familyInvitationView(token);
	if (!invitation || invitation.status !== 'pending') {
		// La UI solo ofrece responder sobre una `pending` vigente: llegar aquí
		// es una UI rancia o una carrera con otro dispositivo.
		return fail(400, { error: m.invitations_unavailable() });
	}

	// Checklist #61: el email de la sesión debe ser el del invitado. El hook
	// del endpoint lo vuelve a comprobar (aquí UX, allí autorización).
	if (
		!invitation.identifier ||
		invitation.identifier.trim().toLowerCase() !== user.email.trim().toLowerCase()
	) {
		return fail(403, { error: m.invitations_not_yours() });
	}

	try {
		if (response === 'accept') {
			await acceptFamilyInvitation(event, token);
		} else {
			await rejectFamilyInvitation(event, token);
		}
	} catch (error) {
		if (error instanceof FamilyMemberLimitReachedError) {
			return fail(400, { error: m.families_invite_limit({ max: FAMILY_MEMBERS_MAX }) });
		}
		if (error instanceof FamilyLimitReachedError) {
			return fail(403, { error: m.families_limit({ max: FAMILIES_MAX }) });
		}
		if (error instanceof FamilyInvitationUnavailableError) {
			return fail(400, { error: m.invitations_unavailable() });
		}
		if (error instanceof FamilyInvitationNotForAccountError) {
			return fail(403, { error: m.invitations_not_yours() });
		}
		logger.error({ err: error }, 'Error al responder la invitación de familia');
		return fail(400, { error: m.invitations_error() });
	}

	if (response === 'accept') {
		// Criterio de aceptación de la issue: el invitado ya es miembro y la ve
		// en su selector de familias.
		redirect(303, '/families');
	}
	// Rechazada: la página re-cargada muestra la invitación en su estado nuevo.
	redirect(303, `/invitations/${token}`);
}

export const actions: Actions = {
	accept: (event) => answer(event, 'accept'),
	reject: (event) => answer(event, 'reject')
};
