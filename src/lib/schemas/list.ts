import { z } from 'zod/v4';

/**
 * Colores de lista: paleta dedicada de 12 tonos (issue #147), desacoplada de
 * los semánticos de daisyUI (que la UI ya no reparte entre listas: eran
 * demasiado parecidos entre temas — amarillo/mostaza/naranja, dos teales).
 * Se guarda el id del tono, no un estilo, para que el tema lo traduzca
 * (`bg-list-<id>` en la UI; los pares `--color-list-*` viven en `app.css`).
 * El remap de los 8 ids semánticos viejos lo hace la migración de datos
 * `20261103120000_list_colors_icons` (sin cambio de esquema).
 */
export const LIST_COLORS = [
	// Tonos tomados del logo (más un lima nuevo).
	'red',
	'orange',
	'yellow',
	'lime',
	'green',
	'teal',
	'cyan',
	// Tonos nuevos para diferenciar establecimientos.
	'blue',
	'purple',
	'pink',
	'brown',
	'gray'
] as const;

/**
 * Iconos de lista: subconjunto moderado del set lucide (issue #147) con
 * nombres en kebab-case, los mismos que las rutas de import
 * (`@lucide/svelte/icons/<nombre>`). Un icono por tipo de establecimiento o
 * producto: de 39 se baja a 20 para que el selector sea escaneable. La UI
 * pinta un selector cerrado con este catálogo, así que la validación es un
 * enum y no un patrón libre: cualquier otra cosa sería un icono que no se
 * puede renderizar. Un spec garantiza que cada nombre existe de verdad en
 * `@lucide/svelte`.
 */
export const LIST_ICONS = [
	// Genéricos
	'shopping-basket',
	'list-checks',
	'house',
	'gift',
	// Comida y bebida
	'apple',
	'croissant',
	'beef',
	'fish',
	'wine',
	'coffee',
	'pizza',
	'candy',
	// Hogar y demás
	'baby',
	'dog',
	'pill',
	'washing-machine',
	'wrench',
	'smartphone',
	'flower-2',
	'book'
] as const;

/** Textos inyectables del schema de lista. Defaults: ninguno (el consumidor los pasa). */
export type ListSchemaStrings = {
	nameError?: string;
	nameLabel?: string;
	namePlaceholder?: string;
	colorError?: string;
	colorLabel?: string;
	iconError?: string;
	iconLabel?: string;
};

/**
 * Factoría del schema de lista (sirve para crear y editar: los campos son los
 * mismos): nunca un schema con textos ya compilados en scope de módulo (regla
 * i18n de la librería), para que el consumidor resuelva su Paraglide cuando
 * toque (en render en el cliente y en request en el servidor).
 *
 * El límite del nombre replica el de la familia (`createFamilySchema`: 1–100).
 * `color` e `icon` son enums cerrados (paleta dedicada y catálogo lucide); el
 * selector de la UI no ofrecerá nada fuera de ellos.
 *
 * Las etiquetas viajan en `.meta()`: `zodToFieldsJsonSchema` las vuelca al
 * `Field` y `FormFields` las pinta (ver `createFamilySchema`).
 */
export function listSchema(strings?: ListSchemaStrings) {
	return z.object({
		name: z
			.string()
			.trim()
			.min(1, strings?.nameError)
			.max(100, strings?.nameError)
			.meta({ description: strings?.nameLabel, placeholder: strings?.namePlaceholder }),
		color: z.enum(LIST_COLORS, strings?.colorError).meta({ description: strings?.colorLabel }),
		icon: z.enum(LIST_ICONS, strings?.iconError).meta({ description: strings?.iconLabel })
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type ListSchema = ReturnType<typeof listSchema>;

/** Los datos validados por el schema. */
export type ListData = z.infer<ListSchema>;
