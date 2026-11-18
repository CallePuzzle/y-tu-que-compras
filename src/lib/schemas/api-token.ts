import { z } from 'zod/v4';

/** Textos inyectables del schema de token de API. Defaults: ninguno (el consumidor los pasa). */
export type ApiTokenSchemaStrings = {
	nameError?: string;
	nameLabel?: string;
	namePlaceholder?: string;
};

/**
 * Factoría del schema de creación de tokens de API (épica #260, tarea #273):
 * nunca un schema con textos ya compilados en scope de módulo (regla i18n de
 * la librería), para que el consumidor resuelva su Paraglide cuando toque (en
 * render en el cliente y en request en el servidor).
 *
 * El tope de 32 caracteres NO es nuestro: es el `maximumNameLength` que aplica
 * por defecto el plugin apiKey de better-auth, y superarlo lanzaría
 * INVALID_NAME_LENGTH tras pasar el formulario. Si el límite del plugin
 * cambiara, este es el sitio que debe seguirle.
 */
export function apiTokenCreateSchema(strings?: ApiTokenSchemaStrings) {
	return z.object({
		name: z
			.string()
			.trim()
			.min(1, strings?.nameError)
			.max(32, strings?.nameError)
			.meta({ description: strings?.nameLabel, placeholder: strings?.namePlaceholder })
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type ApiTokenCreateSchema = ReturnType<typeof apiTokenCreateSchema>;

/** Los datos validados por el schema. */
export type ApiTokenCreateData = z.infer<ApiTokenCreateSchema>;
