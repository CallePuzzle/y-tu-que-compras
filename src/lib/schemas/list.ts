import { z } from 'zod/v4';

/**
 * Colores de lista: la paleta semántica de daisyUI 5. Se guarda el nombre de
 * color, no un estilo, para que el tema lo traduzca (`bg-${color}` en la UI).
 * Quedan fuera las variantes `-content` y `base-*`: no son colores de elección,
 * sino de superficie y contraste.
 */
export const LIST_COLORS = [
	'primary',
	'secondary',
	'accent',
	'neutral',
	'info',
	'success',
	'warning',
	'error'
] as const;

/**
 * Iconos de lista: subconjunto del set lucide con nombres en kebab-case, los
 * mismos que las rutas de import (`@lucide/svelte/icons/<nombre>`). La UI pinta
 * un selector cerrado con este catálogo, así que la validación es un enum y no
 * un patrón libre: cualquier otra cosa sería un icono que no se puede renderizar.
 * Un spec garantiza que cada nombre existe de verdad en `@lucide/svelte`.
 */
export const LIST_ICONS = [
	// Genéricos
	'list-checks',
	'clipboard-list',
	'shopping-basket',
	'shopping-cart',
	'shopping-bag',
	'star',
	'heart',
	'sparkles',
	'gift',
	'ticket',
	'house',
	// Comida y bebida
	'apple',
	'carrot',
	'croissant',
	'egg',
	'fish',
	'beef',
	'milk',
	'pizza',
	'candy',
	'coffee',
	'beer',
	'wine',
	'cup-soda',
	// Hogar y demás
	'baby',
	'dog',
	'cat',
	'pill',
	'leaf',
	'flower-2',
	'paintbrush',
	'wrench',
	'hammer',
	'washing-machine',
	'laptop',
	'smartphone',
	'gamepad-2',
	'book',
	'music'
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
 * `color` e `icon` son enums cerrados (paleta daisyUI y catálogo lucide); el
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
