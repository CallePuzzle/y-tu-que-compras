import { z } from 'zod/v4';

/**
 * Qué hacer con el producto de la despensa al re-añadirlo a una lista
 * (checklist #74): dejarlo tal cual, fijarle una cantidad nueva o quitarlo
 * (se lo llevó toda la receta, por ejemplo). Los valores son identificadores
 * estables en inglés — la UI los traduce con las claves `pantry_readd_*` de
 * Paraglide — y el servidor los aplica en la misma transacción que el alta en
 * la lista: o entra en la lista y se ajusta la despensa, o nada.
 */
export const PANTRY_MODES = ['keep', 'set', 'remove'] as const;

/** Un modo de ajuste de la despensa al re-añadir. */
export type PantryMode = (typeof PANTRY_MODES)[number];

/** Textos inyectables del schema de re-añadir. Defaults: ninguno (el consumidor los pasa). */
export type ReaddSchemaStrings = {
	listIdError?: string;
	listIdLabel?: string;
	pantryModeError?: string;
	pantryModeLabel?: string;
	newQuantityError?: string;
	newQuantityLabel?: string;
	quantityError?: string;
	quantityLabel?: string;
};

/**
 * Factoría del schema de «re-añadir a la compra» (issue #74): qué lista de la
 * familia recibe el producto, cuánto entra en la lista y qué pasa con la
 * despensa. El id del producto de despensa NO va en el schema: viaja como el
 * id oculto de editar/borrar en la lista (el FormData se lee una vez y
 * alimenta a superforms y al id a la vez).
 *
 * `newQuantity` solo aplica con `pantryMode: 'set'`; el `superRefine` lo
 * exige positivo en ese caso (con cualquier otro modo se ignora, venga o no).
 * Las cantidades son > 0, como en el alta de items, y las etiquetas viajan en
 * `.meta()` para que `zodToFieldsJsonSchema` las vuelca al `Field`.
 */
export function readdSchema(strings?: ReaddSchemaStrings) {
	return z
		.object({
			// La lista de destino: una de las de la familia, que puede ser
			// distinta a la de la última compra (criterio de la #46).
			listId: z
				.string(strings?.listIdError)
				.min(1, strings?.listIdError)
				.meta({ description: strings?.listIdLabel }),
			// La cantidad que entra en la LISTA (no la de la despensa).
			quantity: z
				.number(strings?.quantityError)
				.positive(strings?.quantityError)
				.meta({ description: strings?.quantityLabel }),
			// Qué hacer con la despensa: keep (nada), set (fijar) o remove (quitar).
			pantryMode: z
				.enum(PANTRY_MODES, strings?.pantryModeError)
				.meta({ description: strings?.pantryModeLabel }),
			// Solo para `set`: la cantidad que QUEDA en la despensa.
			newQuantity: z
				.number(strings?.newQuantityError)
				.positive(strings?.newQuantityError)
				.optional()
				.meta({ description: strings?.newQuantityLabel })
		})
		.superRefine((data, ctx) => {
			if (data.pantryMode !== 'set' || (data.newQuantity !== undefined && data.newQuantity > 0)) {
				return;
			}
			ctx.addIssue({
				code: 'custom',
				path: ['newQuantity'],
				message: strings?.newQuantityError
			});
		});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type ReaddSchema = ReturnType<typeof readdSchema>;

/** Los datos validados por el schema. */
export type ReaddData = z.infer<ReaddSchema>;
