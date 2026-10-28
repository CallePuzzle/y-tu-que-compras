import { fail, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { formatDateTime } from '$lib/format.js';
import { m } from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime.js';
import {
	FamilyGoneError,
	FamilyInvitationGoneError,
	FamilyLastAdminError,
	FamilyMemberGoneError,
	cancelFamilyInvitation,
	deleteFamily,
	familyDetailView,
	leaveFamily,
	promoteFamilyMember,
	removeFamilyMember
} from '$lib/server/families.js';
import logger from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const family = await familyDetailView(event, event.params.familyId);

	// Familia inexistente o ajena (p. ej. el expulsado con la página abierta o
	// un enlace rancio a una familia borrada): de vuelta al listado, que es la
	// única vista con sentido para quien no pertenece.
	if (!family) {
		redirect(302, '/families');
	}

	// La caducidad de cada pendiente va ya formateada (issue #102): la locale
	// activa se resuelve en request, nunca en scope de módulo.
	const locale = getLocale();
	return {
		family: {
			...family,
			pendingInvitations: family.pendingInvitations.map((invitation) => ({
				...invitation,
				expiresLabel: invitation.expiresAt ? formatDateTime(invitation.expiresAt, locale) : null
			}))
		}
	};
};

/**
 * El id del miembro que viaja en el formulario (input hidden de cada fila).
 * `null` si falta: UI rancia o petición hecha a mano.
 */
async function memberIdOf(event: RequestEvent): Promise<string | null> {
	const memberId = (await event.request.formData()).get('miembro');
	return typeof memberId === 'string' && memberId ? memberId : null;
}

/**
 * El id de la invitación que viaja en el formulario de cancelar (input hidden
 * de cada fila de pendientes). `null` si falta: UI rancia o petición a mano.
 */
async function invitationIdOf(event: RequestEvent): Promise<string | null> {
	const invitationId = (await event.request.formData()).get('invitacion');
	return typeof invitationId === 'string' && invitationId ? invitationId : null;
}

/** Traduce los fallos de expulsar/abandonar/promover a mensajes de la UI. */
function memberActionError(error: unknown) {
	if (error instanceof FamilyLastAdminError) {
		return fail(400, { error: m.families_last_admin() });
	}
	if (error instanceof FamilyMemberGoneError) {
		return fail(400, { error: m.families_member_gone() });
	}
	logger.error({ err: error }, 'Error al gestionar el miembro de la familia');
	return fail(400, { error: m.families_members_error() });
}

export const actions: Actions = {
	// Expulsar (issue #62): lo autoriza el guard del endpoint (solo admin), el
	// último admin incluido en esa protección (no puede ser expulsado el único).
	kick: async (event) => {
		const memberId = await memberIdOf(event);
		if (!memberId) {
			return fail(400, { error: m.families_members_error() });
		}

		try {
			await removeFamilyMember(event, memberId);
		} catch (error) {
			return memberActionError(error);
		}

		return { success: true };
	},

	// Abandonar (issue #62): el propio miembro se quita; el guard del endpoint
	// bloquea al último admin, que debe promover a otro o borrar la familia.
	leave: async (event) => {
		const memberId = await memberIdOf(event);
		if (!memberId) {
			return fail(400, { error: m.families_members_error() });
		}

		try {
			await leaveFamily(event, memberId);
		} catch (error) {
			return memberActionError(error);
		}

		// Sin familia: al listado (el redirect NUNCA dentro del try, que lo
		// capturaría como un error cualquiera).
		redirect(303, '/families');
	},

	// Promover a admin (issue #62): solo admin; el guard del endpoint impide
	// degradar al último admin, y esta acción solo asigna el rol admin.
	promote: async (event) => {
		const memberId = await memberIdOf(event);
		if (!memberId) {
			return fail(400, { error: m.families_members_error() });
		}

		try {
			await promoteFamilyMember(event, event.params.familyId, memberId);
		} catch (error) {
			return memberActionError(error);
		}

		return { success: true };
	},

	// Cancelar una invitación pendiente (issue #102): solo admin (lo evalúa el
	// hook `invitation/revoke` del plugin sobre la familia de la invitación).
	// Ya no pendiente (aceptada o cancelada desde otro dispositivo): el estado
	// deseado se alcanzó y el load revalidado lo muestra sin ruido.
	cancel: async (event) => {
		const invitationId = await invitationIdOf(event);
		if (!invitationId) {
			return fail(400, { error: m.families_invitation_cancel_error() });
		}

		try {
			await cancelFamilyInvitation(event, invitationId);
		} catch (error) {
			if (!(error instanceof FamilyInvitationGoneError)) {
				logger.error({ err: error }, 'Error al cancelar la invitación de la familia');
				return fail(400, { error: m.families_invitation_cancel_error() });
			}
		}

		return { success: true };
	},

	// Borrar la familia (issue #62): solo admin, con confirmación en la UI; el
	// plugin borra en cascada miembros, invitaciones, roles y permisos.
	delete: async (event) => {
		try {
			await deleteFamily(event, event.params.familyId);
		} catch (error) {
			// Ya borrada (doble envío, otro dispositivo): mismo destino.
			if (!(error instanceof FamilyGoneError)) {
				logger.error({ err: error }, 'Error al borrar la familia');
				return fail(400, { error: m.families_members_error() });
			}
		}

		redirect(303, '/families');
	}
};
