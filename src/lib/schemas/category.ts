import { z } from 'zod/v4';

/** Textos inyectables del schema de categoría. Defaults: ninguno (el consumidor los pasa). */
export type CategorySchemaStrings = {
	nameError?: string;
	nameLabel?: string;
	namePlaceholder?: string;
};

/**
 * Factoría del schema de categoría (sirve para crear y renombrar: el campo es
 * el mismo): nunca un schema con textos ya compilados en scope de módulo (regla
 * i18n de la librería), para que el consumidor resuelva su Paraglide cuando
 * toque (en render en el cliente y en request en el servidor).
 *
 * El límite del nombre replica el de la familia y la lista (`createFamilySchema`
 * y `listSchema`: 1–100). NO valida duplicados: «Lácteos» y «LACTEOS» pasan el
 * formulario y el duplicado lo detecta el servidor sobre el nombre normalizado
 * (`normalizeItemName`), que es el contrato de único de la base — el formulario
 * no puede decidirlo porque el canónico es cosa de la capa de datos.
 *
 * La etiqueta viaja en `.meta()`: `zodToFieldsJsonSchema` la vuelca al `Field`
 * y `FormFields` la pinta (ver `listSchema`).
 */
export function categorySchema(strings?: CategorySchemaStrings) {
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
export type CategorySchema = ReturnType<typeof categorySchema>;

/** Los datos validados por el schema. */
export type CategoryData = z.infer<CategorySchema>;
