import { fail } from '@sveltejs/kit';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { m } from '$lib/paraglide/messages.js';
import { createFamilySchema, inviteFamilySchema } from '$lib/schemas/family.js';
import {
	FAMILIES_MAX,
	FAMILY_MEMBERS_MAX,
	AlreadyFamilyMemberError,
	FamilyInvitationPendingError,
	FamilyLimitReachedError,
	FamilyMemberLimitReachedError,
	createFamily,
	familySlug,
	inviteFamily,
	listFamilies
} from '$lib/server/families.js';
import { FAMILY_INVITATION_EXPIRY_HOURS } from '$lib/server/tenancy.js';
import logger from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

// Los schemas se construyen EN REQUEST, nunca en scope de módulo (regla i18n de
// la librería): los textos de Paraglide se resuelven con la locale de la petición.
function familyFormSchema() {
	return createFamilySchema({
		nameError: m.schema_families_name_error(),
		nameLabel: m.schema_families_name_label(),
		namePlaceholder: m.schema_families_name_placeholder()
	});
}

function inviteFormSchema() {
	return inviteFamilySchema({
		emailError: m.schema_families_email_error(),
		emailLabel: m.schema_families_email_label(),
		emailPlaceholder: m.schema_families_email_placeholder()
	});
}

export const load: PageServerLoad = async (event) => {
	return {
		form: await superValidate(zod4(familyFormSchema())),
		// `id` aparte para que superforms sepa a cuál de los dos formularios de
		// la página pertenece cada respuesta de acción.
		inviteForm: await superValidate(zod4(inviteFormSchema()), { id: 'invite' }),
		families: await listFamilies(event),
		// Para el hint del modal de invitar: toda invitación caduca (#102).
		invitationExpiryHours: FAMILY_INVITATION_EXPIRY_HOURS
	};
};

export const actions: Actions = {
	create: async (event) => {
		const form = await superValidate(event.request, zod4(familyFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		// El slug no se pide al usuario (el formulario sólo pide el nombre): se
		// deriva del nombre con sufijo aleatorio para cumplir el formato y la
		// unicidad que el plugin exige.
		try {
			await createFamily(event, { name: form.data.name, slug: familySlug(form.data.name) });
		} catch (error) {
			if (error instanceof FamilyLimitReachedError) {
				// El formulario no se pierde: el modal sigue abierto con el nombre
				// y el aviso concreto, en vez del error genérico.
				return message(form, m.families_limit({ max: FAMILIES_MAX }), { status: 400 });
			}
			logger.error({ err: error }, 'Error al crear la familia');
			return message(form, m.families_error(), { status: 400 });
		}

		return message(form, m.families_success());
	},

	// Invitar por email (issue #60). La familia viaja en la query de la acción:
	// un solo formulario compartido por todas las filas y una familia por envío.
	// El rol de entrada es siempre `member` (el checklist no contempla otros).
	invite: async (event) => {
		const inviteForm = await superValidate(event.request, zod4(inviteFormSchema()), {
			id: 'invite'
		});
		if (!inviteForm.valid) {
			return fail(400, { inviteForm });
		}

		const familyId = event.url.searchParams.get('familyId');
		if (!familyId) {
			return message(inviteForm, m.families_invite_error(), { status: 400 });
		}

		const { email } = inviteForm.data;
		try {
			await inviteFamily(event, { familyId, email });
		} catch (error) {
			// Cada regla de la lista «validación de duplicados y límites» (#60)
			// tiene su mensaje; lo genérico queda para el resto de fallos.
			if (error instanceof AlreadyFamilyMemberError) {
				return message(inviteForm, m.families_invite_member({ email: error.email }), {
					status: 400
				});
			}
			if (error instanceof FamilyInvitationPendingError) {
				return message(inviteForm, m.families_invite_pending({ email: error.email }), {
					status: 400
				});
			}
			if (error instanceof FamilyMemberLimitReachedError) {
				return message(inviteForm, m.families_invite_limit({ max: FAMILY_MEMBERS_MAX }), {
					status: 400
				});
			}
			logger.error({ err: error }, 'Error al enviar la invitación de familia');
			return message(inviteForm, m.families_invite_error(), { status: 400 });
		}

		return message(inviteForm, m.families_invite_success({ email }));
	}
};
