import { fail } from '@sveltejs/kit';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { m } from '$lib/paraglide/messages.js';
import { createFamilySchema } from '$lib/schemas/family.js';
import {
	FAMILIES_MAX,
	FamilyLimitReachedError,
	createFamily,
	familySlug,
	listFamilies
} from '$lib/server/families.js';
import logger from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

// El schema se construye EN REQUEST, nunca en scope de módulo (regla i18n de la
// librería): los textos de Paraglide se resuelven con la locale de la petición.
function familyFormSchema() {
	return createFamilySchema({
		nameError: m.schema_families_name_error(),
		nameLabel: m.schema_families_name_label(),
		namePlaceholder: m.schema_families_name_placeholder()
	});
}

export const load: PageServerLoad = async (event) => {
	const form = await superValidate(zod4(familyFormSchema()));

	return {
		form,
		families: await listFamilies(event)
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
	}
};
