import { z } from 'zod/v4';
import { quantitySchema } from './item.js';

/** Textos inyectables del schema de re-añadir. Defaults: ninguno (el consumidor los pasa). */
export type ReaddSchemaStrings = {
	listIdError?: string;
	listIdLabel?: string;
	quantityError?: string;
	quantityLabel?: string;
};

/**
 * Factoría del schema de «re-añadir a la compra» (issues #74 y #149): qué
 * lista de la familia recibe el producto y cuánto entra en la lista. La
 * despensa NO se toca: el producto se queda como está — la cantidad para la
 * compra es la que se elija, sin preguntas sobre la despensa (#149). El id
 * del producto de despensa NO va en el schema: viaja como el id oculto de
 * editar/borrar en la lista (el FormData se lee una vez y alimenta a
 * superforms y al id a la vez).
 *
 * La cantidad lleva el MISMO contrato que el item (`quantitySchema`, issue
 * #107: mínimo 0.001, techo de la columna y múltiplo de la milésima). Las
 * etiquetas viajan en `.meta()` para que `zodToFieldsJsonSchema` las vuelca
 * al `Field`.
 */
export function readdSchema(strings?: ReaddSchemaStrings) {
	return z.object({
		// La lista de destino: una de las de la familia, que puede ser
		// distinta a la de la última compra (criterio de la #46).
		listId: z
			.string(strings?.listIdError)
			.min(1, strings?.listIdError)
			.meta({ description: strings?.listIdLabel }),
		// La cantidad que entra en la LISTA (no la de la despensa).
		quantity: quantitySchema(strings?.quantityError).meta({
			description: strings?.quantityLabel
		})
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type ReaddSchema = ReturnType<typeof readdSchema>;

/** Los datos validados por el schema. */
export type ReaddData = z.infer<ReaddSchema>;
