import { z } from 'zod/v4';

/**
 * Unidades de un item (issue #67): ud, kg, g, L, ml, paquete, lata, docena.
 * Los valores son identificadores estables en inglés — es lo que guarda el
 * enum nativo `unit` de la base de datos — y NUNCA se muestran tal cual: la
 * UI los traduce con las claves `unit_*` de Paraglide. El catálogo replica el
 * enum de Prisma y un spec garantiza que no se separan: validar y almacenar
 * es el mismo contrato.
 */
export const UNITS = [
	'unit',
	'kilogram',
	'gram',
	'liter',
	'milliliter',
	'package',
	'can',
	'dozen'
] as const;

/** Una unidad del catálogo. */
export type Unit = (typeof UNITS)[number];

/** Textos inyectables del schema de item. Defaults: ninguno (el consumidor los pasa). */
export type ItemSchemaStrings = {
	nameError?: string;
	nameLabel?: string;
	namePlaceholder?: string;
	quantityError?: string;
	quantityLabel?: string;
	unitError?: string;
	unitLabel?: string;
};

/**
 * El contrato de UNA cantidad, compartido por todos los formularios que la
 * traen (alta/edición de item y re-añadido desde la despensa): es exactamente
 * lo que aguanta la columna `DECIMAL(10,3)` de la base de datos (issue #107).
 *
 * - Mínimo 0.001: con solo `.positive()`, un `0.0001` pasaba la validación y
 *   Postgres lo redondeaba a 0 — el producto llegaba a la despensa ya
 *   «Agotado», y un `CHECK (quantity > 0)` lo habría rechazado a medias.
 * - Máximo 9.999.999,999: el techo exacto de la columna. Un valor mayor (o
 *   un `increment` de despensa que lo cruce) muere con «numeric field
 *   overflow» y dejaba la compra imposible de finalizar.
 * - Múltiplo de 0.001: la precisión de la columna. `multipleOf` de zod es
 *   tolerante al error de coma flotante (0.003, 0.1 y 2.75 pasan; 3.14159,
 *   no), así que ni cliente ni servidor aceptan lo que la base iba a
 *   redondear por su cuenta.
 */
export const QUANTITY_MIN = 0.001;
export const QUANTITY_MAX = 9_999_999.999;
export const QUANTITY_STEP = 0.001;

/** El schema de una cantidad: el mismo en el item y en el re-añadido. */
export function quantitySchema(error?: string) {
	return z
		.number(error)
		.min(QUANTITY_MIN, error)
		.max(QUANTITY_MAX, error)
		.multipleOf(QUANTITY_STEP, error);
}

/**
 * Factoría del schema de item (sirve para crear y editar: los campos son los
 * mismos): nunca un schema con textos ya compilados en scope de módulo (regla
 * i18n de la librería), para que el consumidor resuelva su Paraglide cuando
 * toque (en render en el cliente y en request en el servidor).
 *
 * El límite del nombre replica el de la lista y la familia (1–100). La
 * cantidad es Decimal > 0 en la base de datos (`DECIMAL(10,3)`); el schema
 * replica SU contrato exacto — mínimo una milésima, techo de columna y
 * múltiplo de la milésima (`quantitySchema`) — para que nada llegue a la base
 * dispuesto a ser redondeado o a desbordar (issue #107).
 *
 * Las etiquetas viajan en `.meta()`: `zodToFieldsJsonSchema` las vuelca al
 * `Field` y `FormFields` las pinta (ver `createFamilySchema`).
 */
export function itemSchema(strings?: ItemSchemaStrings) {
	return z.object({
		name: z
			.string()
			.trim()
			.min(1, strings?.nameError)
			.max(100, strings?.nameError)
			.meta({ description: strings?.nameLabel, placeholder: strings?.namePlaceholder }),
		quantity: quantitySchema(strings?.quantityError).meta({ description: strings?.quantityLabel }),
		unit: z.enum(UNITS, strings?.unitError).meta({ description: strings?.unitLabel })
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type ItemSchema = ReturnType<typeof itemSchema>;

/** Los datos validados por el schema. */
export type ItemData = z.infer<ItemSchema>;
