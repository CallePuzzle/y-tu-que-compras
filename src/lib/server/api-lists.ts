import { listSchema } from '#lib/schemas/list.js';

// Bodies de los endpoints de listas de la API pública /api/v1 (épica #260,
// tarea #272). El POST valida con `listSchema` tal cual (el mismo del
// formulario web); el PATCH, con esta variante parcial. Vive aquí y no en el
// `+server.ts` porque la spec OpenAPI (T6.1, #267) deriva de él el schema del
// body: un `+server.ts` solo puede exportar handlers.

/**
 * Body del PATCH de listas: los campos de `listSchema`, todos opcionales
 * (actualización parcial de nombre/color/icono), pero al menos uno — un PATCH
 * vacío es casi seguro un error del cliente.
 */
export function apiListPatchSchema() {
	return listSchema()
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: 'At least one of name, color or icon is required'
		});
}
