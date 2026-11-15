import { z } from 'zod/v4';
import { quantitySchema, UNITS } from './item.js';

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

/** Textos inyectables del schema de edición. Defaults: ninguno (el consumidor los pasa). */
export type EditSchemaStrings = {
	quantityError?: string;
	quantityLabel?: string;
	unitError?: string;
	unitLabel?: string;
};

/**
 * Factoría del schema de edición de un producto de despensa (#249): cuánto
 * queda y en qué unidad. El nombre NO se toca (el canónico de la despensa es
 * el de la primera compra) y el id del producto NO va en el schema: viaja como
 * el id oculto del FormData, patrón del re-añadido — el FormData se lee UNA
 * vez y alimenta a superforms y al id a la vez.
 *
 * La cantidad lleva el MISMO contrato que el item (`quantitySchema`, issue
 * #107: mínimo 0.001 — el agotado no va por aquí: se consume hasta 0 y de ahí
 * se re-añade o se quita —, techo de la columna y múltiplo de la milésima).
 * La unidad replica el catálogo `UNITS`, el mismo que guarda el enum nativo.
 * Las etiquetas viajan en `.meta()` para que `zodToFieldsJsonSchema` las
 * vuelva al `Field`, como en `readdSchema`.
 */
export function editSchema(strings?: EditSchemaStrings) {
	return z.object({
		quantity: quantitySchema(strings?.quantityError).meta({
			description: strings?.quantityLabel
		}),
		unit: z.enum(UNITS, strings?.unitError).meta({ description: strings?.unitLabel })
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type EditSchema = ReturnType<typeof editSchema>;

/** Los datos validados por el schema. */
export type EditData = z.infer<EditSchema>;
