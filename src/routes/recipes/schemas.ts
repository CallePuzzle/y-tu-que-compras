import { z } from 'zod/v4';
import { m } from '#lib/paraglide/messages.js';
import { recipeSchema, recipeUpdateSchema } from '#lib/schemas/recipe.js';
import { mealPlanFormSchema } from '../calendar/schemas.js';

// El schema de la vista de recetas (épica #232, tarea #239), compartido por el
// servidor (validación de las acciones de crear y editar) y el modal (validación
// en cliente). El schema de receta YA existe (`#lib/schemas/recipe.ts`, #238):
// aquí solo se consumen sus textos inyectables. Función y no constante: se
// construye EN REQUEST/RENDER, nunca en scope de módulo (regla i18n de la
// librería), para que los textos salgan en la locale de quien pide. Ojo en
// cliente: `superForm` no soporta cambiar el schema, así que se lee una vez por
// instancia; si el idioma cambia con la página abierta, los mensajes se
// re-traducen al recargar.
//
// La cantidad y la unidad del ingrediente comparten las claves de los items (el
// contrato `quantitySchema` y el enum `UNITS` son el MISMO, issue #107); el
// nombre de la receta, sus raciones y el nombre del ingrediente llevan claves
// `schema_recipes_*`. La categoría y el producto de despensa del ingrediente no
// llevan UI propia (el enlace al producto lo decide el autocompletado, no un
// select), así que sus textos quedan sin inyectar.
function recipeStrings() {
	return {
		nameError: m.schema_recipes_name_error(),
		nameLabel: m.schema_recipes_name_label(),
		servingsError: m.schema_recipes_servings_error(),
		servingsLabel: m.schema_recipes_servings_label(),
		ingredientNameError: m.schema_recipes_ingredient_name_error(),
		ingredientNameLabel: m.schema_recipes_ingredient_name_label(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.schema_items_quantity_label(),
		unitError: m.schema_items_unit_error(),
		unitLabel: m.schema_items_unit_label()
	};
}

/** El schema de crear receta (validan la acción y el modal en cliente). */
export function recipeFormSchema() {
	return recipeSchema(recipeStrings());
}

/**
 * El contrato de EDITAR receta: los campos de crear MÁS el id de la receta.
 * El id no va en `$form` (crear y editar comparten el mismo contrato), así que
 * el modal lo inyecta en el JSON de salida (`onSubmit`) y el action de editar
 * lo valida con ESTE schema — el `extend` que vive junto al schema compartido
 * (ver `recipeUpdateSchema`), con los mismos textos. Va OPCIONAL a propósito:
 * si un id ausente o vacío (petición hecha a mano) muriera en el schema, el
 * 400 no llevaría mensaje y el modal se quedaría mudo; así el action lo
 * convierte en el aviso controlado «no existe».
 */
export function recipeUpdateFormSchema() {
	return recipeUpdateSchema(recipeStrings());
}

/**
 * El contrato de ASIGNAR receta al menú (#242): los campos del menú del
 * calendario MÁS el id de la receta de la que nace. El schema de menú YA
 * existe — se reutiliza con SUS textos (`mealPlanFormSchema` del calendario,
 * la referencia de la mecánica que replica este modal) y solo se añade el
 * `recipeId` por el MISMO patrón del id en edición (`mealPlanUpdateSchema`):
 * no va en el schema compartido porque un menú creado a mano no lo lleva,
 * así que el modal lo inyecta en el JSON de salida (`onSubmit`, fuera de
 * `$form`) y el action lo valida con ESTE schema. Va OPCIONAL a propósito:
 * que la FK pertenezca a la familia lo resuelve el SERVIDOR
 * (`resolveRecipeId` de `mealplans.ts`) — un id ausente, ajeno o rancio se
 * guarda como «sin receta», sin 500.
 */
export function recipeMealPlanFormSchema() {
	return mealPlanFormSchema().extend({ recipeId: z.string().optional() });
}
