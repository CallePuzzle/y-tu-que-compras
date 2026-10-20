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
