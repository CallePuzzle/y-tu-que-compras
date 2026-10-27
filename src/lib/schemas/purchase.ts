import { z } from 'zod/v4';

/** Textos inyectables del schema de compra. Defaults: ninguno (el consumidor los pasa). */
export type PurchaseSchemaStrings = {
	totalError?: string;
	totalLabel?: string;
};

/**
 * Factoría del schema de «finalizar compra» (issue #70): lo único que viaja
 * desde el modal de confirmación (#71) es el total del ticket, que el usuario
 * escribe a mano.
 *
 * El total es un número >= 0 — un ticket puede salir gratis — y en la base es
 * `DECIMAL(10,2)` (ver PurchaseRecord.total): euros con céntimos. Sin tope: un
 * valor que desborde la columna muere en el action con el error genérico,
 * igual que cualquier otro fallo de base de datos.
 *
 * Las etiquetas viajan en `.meta()`: `zodToFieldsJsonSchema` las vuelca al
 * `Field` y `FormFields` las pinta (ver `createFamilySchema`).
 */
export function purchaseSchema(strings?: PurchaseSchemaStrings) {
	return z.object({
		total: z
			.number(strings?.totalError)
			.nonnegative(strings?.totalError)
			.meta({ description: strings?.totalLabel })
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type PurchaseSchema = ReturnType<typeof purchaseSchema>;

/** Los datos validados por el schema. */
export type PurchaseData = z.infer<PurchaseSchema>;
