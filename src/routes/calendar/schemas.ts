import { z } from 'zod/v4';
import { m } from '#lib/paraglide/messages.js';
import { mealPlanSchema } from '#lib/schemas/mealplan.js';

// El schema de la vista de calendario, compartido por el servidor (validación
// de la acción de crear menú, #222) y el modal (validación en cliente). El
// schema de menú YA existe (`#lib/schemas/mealplan.ts`, tarea #225): aquí solo
// se consumen sus textos inyectables. Función y no constante: se construye EN
// REQUEST/RENDER, nunca en scope de módulo (regla i18n de la librería), para
// que los textos salgan en la locale de quien pide. Ojo en cliente:
// `superForm` no soporta cambiar el schema, así que se lee una vez por
// instancia; si el idioma cambia con la página abierta, los mensajes se
// re-traducen al recargar.
//
// La cantidad y la unidad del ingrediente comparten las claves de los items
// (el contrato `quantitySchema` y el enum `UNITS` son el MISMO, issue #107);
// el nombre del ingrediente y los campos propios del menú llevan claves
// `schema_mealplans_*`.
export function mealPlanFormSchema() {
	return mealPlanSchema({
		titleError: m.schema_mealplans_title_error(),
		titleLabel: m.schema_mealplans_title_label(),
		dateError: m.schema_mealplans_date_error(),
		dateLabel: m.schema_mealplans_date_label(),
		mealTypeError: m.schema_mealplans_meal_type_error(),
		mealTypeLabel: m.schema_mealplans_meal_type_label(),
		ingredientNameError: m.schema_mealplans_ingredient_name_error(),
		ingredientNameLabel: m.schema_mealplans_ingredient_name_label(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.schema_items_quantity_label(),
		unitError: m.schema_items_unit_error(),
		unitLabel: m.schema_items_unit_label(),
		categoryLabel: m.schema_items_category_label()
	});
}

/**
 * El contrato de EDITAR menú (#221): los campos de crear MÁS el id del menú.
 * El id no va en el schema compartido (crear y editar tienen los mismos
 * campos), así que el modal lo inyecta en el JSON de salida (`onSubmit`,
 * fuera de `$form`) y el action de editar lo valida con ESTE schema — un
 * `extend` del de crear, para no repetir un solo texto ni un solo campo.
 * Va OPCIONAL a propósito: si un id ausente o vacío (petición hecha a mano)
 * muriera en el schema, el 400 no llevaría mensaje y el modal se quedaría
 * mudo; así el action lo convierte en el aviso controlado «no existe», que
 * la UI pinta dentro del modal como el resto de fallos.
 */
export function mealPlanUpdateSchema() {
	return mealPlanFormSchema().extend({ id: z.string().optional() });
}
