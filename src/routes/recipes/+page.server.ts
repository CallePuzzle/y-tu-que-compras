import { fail } from '@sveltejs/kit';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { APP_TIME_ZONE } from '#lib/format.js';
import { m } from '#lib/paraglide/messages.js';
import { requireActiveFamily } from '#lib/server/family-context.js';
import logger from '#lib/server/logger.js';
import { MealPlanExistsError, createMealPlan } from '#lib/server/mealplans.js';
import { listPantryItems } from '#lib/server/pantry.js';
import {
	RecipeExistsError,
	createRecipe,
	deleteRecipe,
	listRecipes,
	updateRecipe
} from '#lib/server/recipes.js';
import { dateKeyOf } from '../calendar/grid.js';
import { recipeFormSchema, recipeMealPlanFormSchema, recipeUpdateFormSchema } from './schemas.js';
import type { Actions, PageServerLoad } from './$types';

// La vista de recetas de la familia activa (épica #232, tarea #239): el load
// trae el listado alfabético y los productos de despensa para el
// autocompletado del modal; las acciones create/update/delete traducen el
// schema compartido y el `RecipeExistsError` a superforms y mensajes de UI
// (patrón calendario: 400/409/404/500 en `message`, sin filtrar el error
// crudo). Guardar una receta NO crea productos en despensa (decisión de fase
// 2): el CRUD de `recipes.ts` solo ENLAZA el id que llega validado. La
// acción assignToMenu (#242) lleva la receta AL MENÚ por la capa de
// servidor del calendario (`createMealPlan`), con el `recipeId` como
// trazabilidad del origen.

/**
 * Valores iniciales del formulario de crear receta: una fila de ingrediente
 * vacía lista para escribir — como el item del alta rápida, cantidad 1 y
 * «ud» —. El `pantryItemId` vacío significa «sin enlace»: lo rellena el
 * autocompletado si el nombre tecleado ES un producto de la familia y el
 * servidor lo guarda como `null` (ver `resolvePantryItemId`).
 */
const EMPTY_RECIPE = {
	name: '',
	ingredients: [{ name: '', quantity: 1, unit: 'unit' as const, pantryItemId: '' }]
};

/**
 * Valores iniciales del formulario de asignar al menú (#242): el día lo fija
 * el modal al abrirse (el «hoy» que este load sirve ya resuelto) y el título
 * y los ingredientes los precarga la receta elegida, así que aquí todo va
 * vacío — la comida como tipo por defecto (la principal del día) y una fila
 * de ingrediente, igual que el formulario del calendario.
 */
const EMPTY_MENU_PLAN = {
	title: '',
	date: '',
	mealType: 'lunch' as const,
	ingredients: [{ name: '', quantity: 1, unit: 'unit' as const }]
};

/**
 * El id de receta que viaja en el formulario de borrar (input hidden del
 * ConfirmModal): `null` si falta o es basura, como `mealPlanIdOf` del
 * calendario.
 */
function recipeIdOf(data: FormData): string | null {
	const id = data.get('id');
	return typeof id === 'string' && id ? id : null;
}

// La familia activa es la puerta de la vista (issue #63): `requireActiveFamily`
// manda a `/families` a quien no tiene o no ha elegido, y su id — ya
// verificado contra la membresía — es el que filtra TODAS las queries.
export const load: PageServerLoad = async (event) => {
	const family = requireActiveFamily(event);

	// Las recetas de la familia, alfabéticas (lo trae `listRecipes`): la vista
	// solo añade SU filtro de nombre en cliente.
	const recipes = await listRecipes(family.id);

	// Los productos de despensa para el autocompletado del modal: id (la FK
	// `pantryItemId` del ingrediente), nombre (lo que sugiere el `datalist`) y
	// unidad (la que hereda la fila al elegirlo). El mismo nombre puede salir
	// DOS veces con unidades distintas (un producto por fila de despensa): el
	// modal se queda con el primero y el aviso de unidad conflictiva es la
	// tarea #240.
	const pantryItems = (await listPantryItems(family.id)).map(({ id, name, unit }) => ({
		id,
		name,
		unit
	}));

	return {
		recipes,
		pantryItems,
		// El «hoy» de la zona de la app (el cliente no calcula fechas, las
		// sirve el servidor: ver `grid.ts` del calendario): el día por defecto
		// del modal de asignar al menú (#242).
		todayKey: dateKeyOf(new Date(), APP_TIME_ZONE),
		form: await superValidate(EMPTY_RECIPE, zod4(recipeFormSchema())),
		menuForm: await superValidate(EMPTY_MENU_PLAN, zod4(recipeMealPlanFormSchema()))
	};
};

export const actions: Actions = {
	// Crear receta (#239): el schema valida nombre, raciones opcionales e
	// ingredientes; la FK al producto de despensa la resuelve el SERVIDOR
	// (`resolvePantryItemId`: un id ajeno o rancio queda «sin enlace», y NADA
	// se crea en la despensa). El único (familia, nombre normalizado) muere en
	// P2002 y sale como `RecipeExistsError`: mensaje genérico dentro del modal
	// (patrón calendario). Tras crear, `invalidateAll: 'pessimistic'` en el
	// cliente rerun el load y el listado repinta la receta en su sitio.
	create: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(recipeFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		try {
			await createRecipe(family.id, form.data);
		} catch (error) {
			if (error instanceof RecipeExistsError) {
				return message(form, m.recipe_duplicate(), { status: 409 });
			}
			logger.error({ err: error }, 'Error al crear la receta');
			// Fallo inesperado (BD caída, columna…): 5xx, que el cliente y la
			// monitorización lo vean como lo que es (issue #110).
			return message(form, m.recipe_error(), { status: 500 });
		}

		return message(form, m.recipe_success());
	},

	// Editar receta (#239): el modal de crear REUTILIZADO, precargado con la
	// receta elegida. Valida el schema de editar (el de crear más el id, ver
	// `schemas.ts`): el body llega como JSON con `dataType: 'json'` y
	// `superValidate(request, …)` lo valida entero. `updateRecipe` solo toca
	// recetas DE LA FAMILIA ACTIVA: un id ajeno o rancio llega como `false` —
	// 404 controlado (issue #110), no 500.
	update: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(recipeUpdateFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		// El id ya validado se separa: al CRUD le llegan los MISMOS datos que
		// a `createRecipe`. Si falta o va vacío (petición hecha a mano), el
		// aviso controlado dentro del modal — sin 500, como el resto de
		// basura de UI.
		const { id, ...recipe } = form.data;
		if (!id) {
			return message(form, m.recipe_gone(), { status: 400 });
		}

		try {
			const updated = await updateRecipe(family.id, id, recipe);
			if (!updated) {
				return message(form, m.recipe_gone(), { status: 404 });
			}
		} catch (error) {
			if (error instanceof RecipeExistsError) {
				// Renombrar a un nombre que ya ocupa OTRA receta: el mensaje
				// genérico, como en crear.
				return message(form, m.recipe_duplicate(), { status: 409 });
			}
			logger.error({ err: error }, 'Error al editar la receta');
			return message(form, m.recipe_error(), { status: 500 });
		}

		return message(form, m.recipe_updated());
	},

	// Asignar receta al menú (#242): el modal llega con el título y los
	// ingredientes PREFIJADOS desde la receta (editables) y el `recipeId`
	// como trazabilidad. Valida el schema de menú extendido con el id de
	// receta (ver `schemas.ts`): el body llega como JSON con `dataType:
	// 'json'` y `superValidate(request, …)` lo valida entero. La creación es
	// la MISMA capa de servidor del calendario (`createMealPlan`): el único
	// (familia, fecha, tipo) muere en P2002 y el `MealPlanExistsError` sale
	// como 409, que el modal pinta dentro de sí para reintentar otro hueco;
	// la FK de la receta la resuelve el servidor (`resolveRecipeId`) y la
	// despensa la garantiza `ensurePantryProducts` intacto de fase 1 — cada
	// ingrediente crea su producto a cantidad 0 si no estaba. Tras crear,
	// `invalidateAll: 'pessimistic'` en el cliente rerun el load.
	assignToMenu: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(recipeMealPlanFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		try {
			await createMealPlan(family.id, form.data);
		} catch (error) {
			if (error instanceof MealPlanExistsError) {
				return message(form, m.meal_plan_exists(), { status: 409 });
			}
			logger.error({ err: error }, 'Error al asignar la receta al menú');
			// Fallo inesperado (BD caída, columna…): 5xx, que el cliente y la
			// monitorización lo vean como lo que es (issue #110).
			return message(form, m.meal_plan_error(), { status: 500 });
		}

		return message(form, m.meal_plan_success());
	},

	// Borrar receta (#239): confirmación en la UI (ConfirmModal). Sin schema de
	// superforms (solo el id oculto), como el borrado de menús. La despensa NO
	// se toca y los menús que nacieron de la receta tampoco (su FK es
	// `SetNull`). Un id ajeno o de doble envío sale de `deleteRecipe` como
	// `false`: 404, que el ConfirmModal pinta dentro de sí, sin 500.
	delete: async (event) => {
		const family = requireActiveFamily(event);
		const id = recipeIdOf(await event.request.formData());
		if (!id) {
			return fail(400, { error: m.recipe_error() });
		}

		try {
			const deleted = await deleteRecipe(family.id, id);
			if (!deleted) {
				return fail(404, { error: m.recipe_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al borrar la receta');
			return fail(500, { error: m.recipe_error() });
		}

		return { success: true };
	}
};
