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
 * Factoría del schema de item (sirve para crear y editar: los campos son los
 * mismos): nunca un schema con textos ya compilados en scope de módulo (regla
 * i18n de la librería), para que el consumidor resuelva su Paraglide cuando
 * toque (en render en el cliente y en request en el servidor).
 *
 * El límite del nombre replica el de la lista y la familia (1–100). La
 * cantidad es Decimal > 0 en la base de datos (`DECIMAL(10,3)`); en el
 * formulario es un número estrictamente positivo — sin tope: un valor que
 * desborde la columna muere en el action con el error genérico, igual que
 * cualquier otro fallo de base de datos.
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
		quantity: z
			.number(strings?.quantityError)
			.positive(strings?.quantityError)
			.meta({ description: strings?.quantityLabel }),
		unit: z.enum(UNITS, strings?.unitError).meta({ description: strings?.unitLabel })
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type ItemSchema = ReturnType<typeof itemSchema>;

/** Los datos validados por el schema. */
export type ItemData = z.infer<ItemSchema>;
