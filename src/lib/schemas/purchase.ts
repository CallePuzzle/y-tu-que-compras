import { z } from 'zod/v4';

/** Textos inyectables del schema de compra. Defaults: ninguno (el consumidor los pasa). */
export type PurchaseSchemaStrings = {
	totalError?: string;
	totalLabel?: string;
	storeLabel?: string;
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
 *
 * El establecimiento es OPCIONAL (tarea #185): el select del modal ofrece las
 * tiendas de la familia más el option vacío («Sin establecimiento»), que llega
 * como `''` y significa lo mismo que ausente. AQUÍ solo se valida la forma —
 * que el id pertenezca a la familia lo resuelve el SERVIDOR
 * (`finalizePurchase`), igual que la lista: el formulario no puede autorizar
 * por id.
 */
export function purchaseSchema(strings?: PurchaseSchemaStrings) {
	return z.object({
		total: z
			.number(strings?.totalError)
			.nonnegative(strings?.totalError)
			.meta({ description: strings?.totalLabel }),
		storeId: z.string().optional().meta({ description: strings?.storeLabel })
	});
}

/** El schema (lo que esperan los adaptadores de superforms). */
export type PurchaseSchema = ReturnType<typeof purchaseSchema>;

/** Los datos validados por el schema. */
export type PurchaseData = z.infer<PurchaseSchema>;
