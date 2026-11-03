import { z } from 'zod/v4';

/** Textos inyectables del schema de establecimiento. Defaults: ninguno (el consumidor los pasa). */
export type StoreSchemaStrings = {
	nameError?: string;
	nameLabel?: string;
	namePlaceholder?: string;
};

/**
 * Factoría del schema de establecimiento (sirve para crear y renombrar: el
 * campo es el mismo): nunca un schema con textos ya compilados en scope de
 * módulo (regla i18n de la librería), para que el consumidor resuelva su
 * Paraglide cuando toque (en render en el cliente y en request en el
 * servidor).
 *
 * El límite del nombre replica el de la familia, la lista y la categoría
 * (`createFamilySchema`, `listSchema` y `categorySchema`: 1–100). NO valida
 * duplicados: «Mercadona» y «MERCADONA» pasan el formulario y el duplicado lo
 * detecta el servidor sobre el nombre normalizado (`normalizeItemName`), que
 * es el contrato de único de la base — el formulario no puede decidirlo
 * porque el canónico es cosa de la capa de datos.
 *
 * La etiqueta viaja en `.meta()`: `zodToFieldsJsonSchema` la vuelca al `Field`
 * y `FormFields` la pinta (ver `listSchema`).
 */
export function storeSchema(strings?: StoreSchemaStrings) {
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
export type StoreSchema = ReturnType<typeof storeSchema>;

/** Los datos validados por el schema. */
export type StoreData = z.infer<StoreSchema>;
