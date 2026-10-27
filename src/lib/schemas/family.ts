import { z } from 'zod/v4';

/** Textos inyectables del schema de crear familia. Defaults: ninguno (el consumidor los pasa). */
export type CreateFamilySchemaStrings = {
	nameError?: string;
	nameLabel?: string;
	namePlaceholder?: string;
};

/**
 * Factoría del schema de creación de familia: nunca un schema con textos ya
 * compilados en scope de módulo (regla i18n de la librería), para que el
 * consumidor resuelva su Paraglide cuando toque (en render en el cliente y en
 * request en el servidor).
 *
 * Los límites replican los del endpoint del plugin de tenancy (`name`: 1–100);
 * el `slug` que también exige el plugin no se pide al usuario: lo deriva el
 * servidor (`familySlug` en `$lib/server/families`).
 *
 * `nameLabel` y `namePlaceholder` viajan en `.meta()`: `zodToFieldsJsonSchema`
 * los vuelca al `Field` y `FormFields` los pinta (la description actúa de
 * etiqueta cuando no hay `label` explícita, ver `FormString`).
 */
export function createFamilySchema(strings?: CreateFamilySchemaStrings) {
	return z.object({
		name: z
			.string()
			.trim()
			.min(1, strings?.nameError)
			.max(100, strings?.nameError)
			.meta({ description: strings?.nameLabel, placeholder: strings?.namePlaceholder })
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type CreateFamilySchema = ReturnType<typeof createFamilySchema>;

/** Los datos validados por el schema. */
export type CreateFamilyData = z.infer<CreateFamilySchema>;

/** Textos inyectables del schema de invitar a una familia. Defaults: ninguno. */
export type InviteFamilySchemaStrings = {
	emailError?: string;
	emailLabel?: string;
	emailPlaceholder?: string;
};

/**
 * Factoría del schema de invitar por email: misma regla i18n que el de crear
 * (textos inyectables, nunca compilados en scope de módulo).
 *
 * Solo pide el email: el rol de entrada es siempre `member` (issue #60) y la
 * familia va en la query de la acción, no en el formulario.
 *
 * `emailLabel` y `emailPlaceholder` viajan en `.meta()`: `zodToFieldsJsonSchema`
 * los vuelca al `Field` (con `format: 'email'` → `<input type="email">`) y
 * `FormFields` los pinta.
 */
export function inviteFamilySchema(strings?: InviteFamilySchemaStrings) {
	return z.object({
		email: z
			.email(strings?.emailError)
			.meta({ description: strings?.emailLabel, placeholder: strings?.emailPlaceholder })
	});
}

/** El schema de invitar (para los adaptadores de superforms). */
export type InviteFamilySchema = ReturnType<typeof inviteFamilySchema>;

/** Los datos validados por el schema de invitar. */
export type InviteFamilyData = z.infer<InviteFamilySchema>;
