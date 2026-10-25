import type { InvitationStatus } from '@zytera/better-auth-tenancy';
import prisma from '$lib/server/prisma';
import type { PageServerLoad } from './$types';

/**
 * Vista de una invitación por token (el enlace del correo, issue #60).
 *
 * El guard de sesión (`hooks.server.ts`) ya ha mandado a `/login?redirectTo=…`
 * a quien llega sin sesión: aquí siempre hay sesión. La página SOLO muestra el
 * estado de la invitación; aceptarla o rechazarla es la issue #61.
 */
export const load: PageServerLoad = async ({ params }) => {
	const invitation = await prisma.invitation.findUnique({
		where: { token: params.token },
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
		return { invitation: null };
	}
	const family = await prisma.organization.findUnique({
		where: { id: invitation.contextId },
		select: { name: true }
	});
	if (!family) {
		return { invitation: null };
	}

	// Pendiente y caducada: el cron de cleanup marcará `expired`, pero el
	// invitado no tiene por qué esperar a ese barrido para ver el estado real.
	const expired =
		invitation.status === 'pending' &&
		invitation.expiresAt !== null &&
		invitation.expiresAt < new Date();

	return {
		invitation: {
			// El modelo solo guarda los estados de `InvitationStatus` (los escribe
			// el plugin); el `as` solo recupera el literal tras venir de Prisma.
			status: (expired ? 'expired' : invitation.status) as InvitationStatus,
			identifier: invitation.identifier,
			familyName: family.name,
			invitedBy: invitation.invitedByUser?.name?.trim() || invitation.invitedByUser?.email || ''
		}
	};
};
