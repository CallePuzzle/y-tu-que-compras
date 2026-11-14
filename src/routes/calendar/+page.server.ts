import { fail } from '@sveltejs/kit';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { APP_TIME_ZONE } from '#lib/format.js';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import { requireActiveFamily } from '#lib/server/family-context.js';
import { listCategories } from '#lib/server/categories.js';
import {
	MealPlanExistsError,
	createMealPlan,
	deleteMealPlan,
	listMealPlans,
	updateMealPlan
} from '#lib/server/mealplans.js';
import logger from '#lib/server/logger.js';
import { listPantryItems } from '#lib/server/pantry.js';
import { listPurchasesByDay } from '#lib/server/purchases.js';
import {
	buildMonthGrid,
	monthKeyOf,
	monthKeySchema,
	monthLabelOf,
	shiftMonth,
	weekdayLabels
} from './grid.js';
import { mealPlanFormSchema, mealPlanUpdateSchema } from './schemas.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Valores iniciales del formulario de crear menú (#222): la comida es la más
 * común (la principal del día) y el ingrediente arranca como el item del alta
 * rápida — cantidad 1 y unidad «ud». El día lo fija el modal al abrirse con
 * la celda pulsada, así que aquí va vacío.
 */
const EMPTY_MEAL_PLAN = {
	title: '',
	date: '',
	mealType: 'lunch' as const,
	ingredients: [{ name: '', quantity: 1, unit: 'unit' as const, categoryId: '' }]
};

/**
 * El id de menú que viaja en el formulario de borrar (input hidden del
 * ConfirmModal): `null` si falta o es basura, como `itemIdOf` de las listas.
 */
function mealPlanIdOf(data: FormData): string | null {
	const id = data.get('id');
	return typeof id === 'string' && id ? id : null;
}

// El esqueleto del calendario (épica #212, tarea #217) más su tab de menús
// (#222): el mes en vista manda SIEMPRE en la query (`?month=YYYY-MM`) y se
// resuelve EN SERVIDOR — el cliente no calcula nada de fechas, solo pinta lo
// que trae el load. La familia activa es la puerta de la vista, como en
// listas, despensa e historial (issue #63): los menús, las categorías y las
// sugerencias de despensa viajan filtrados por ella, colgando de las celdas
// del grid que aquí se calcula.
export const load: PageServerLoad = async (event) => {
	// El gate (302 a /families sin familia activa) y, desde aquí, el contexto
	// verificado para todas las queries de la vista.
	const family = requireActiveFamily(event);

	// ¿El mes de la query o el actual? Ausente o basura (`?month=x`,
	// `2026-13`, `26-11`…) caen al mes actual — EN LA ZONA DE LA APP: el
	// «hoy» de quien usa la app desde Madrid manda, no el del servidor en
	// UTC (misma razón que la zona fijada en `format.ts`).
	const now = new Date();
	const parsed = monthKeySchema.safeParse(event.url.searchParams.get('month'));
	const monthKey = parsed.success ? parsed.data : monthKeyOf(now, APP_TIME_ZONE);

	// Los nombres de mes y de día se componen EN SERVIDOR con la locale de
	// la petición (regla i18n): el cliente no repite el `Intl`, así que no
	// puede desdecir al servidor ni divergir al hidratar.
	const locale = getLocale();

	// Los menús del mes, agrupados POR DÍA: la clave de cada grupo es la
	// misma `YYYY-MM-DD` que llevan las celdas del grid (`buildMonthGrid`),
	// así que la vista los cuelga de cada celda sin buscar (tarea #222).
	const mealPlans = await listMealPlans(family.id, monthKey);

	// Los gastos del mes, agrupados POR DÍA (tarea #220): la misma clave de
	// celda — `listPurchasesByDay` la resuelve en la zona de la app (Europe/
	// Madrid), igual que los menús. Los días sin compras no aparecen en el
	// Record: su ausencia ES el estado vacío del tab.
	const purchasesByDay = await listPurchasesByDay(family.id, monthKey);

	// El total del mes, suma EXACTA de sus días: se acumula en céntimos como
	// los días (`listPurchasesByDay`) y viaja YA calculado — el cliente no
	// repite la aritmética, solo pinta la cabecera del tab.
	const expensesMonthTotal =
		Object.values(purchasesByDay).reduce((sum, day) => sum + Math.round(day.total * 100), 0) / 100;

	// Los productos de la despensa: el autocompletado del nombre del
	// ingrediente (`datalist`) se alimenta de ellos y el chip de unidad
	// conflictiva del modal los busca (#243) — id (trazabilidad de la
	// sugerencia), nombre y unidad (la que el chip compara). El mismo nombre
	// puede salir DOS veces con unidades distintas (un producto por fila de
	// despensa): es justo lo que el chip necesita para avisar.
	const pantryItems = (await listPantryItems(family.id)).map(({ id, name, unit }) => ({
		id,
		name,
		unit
	}));

	return {
		monthKey,
		monthLabel: monthLabelOf(monthKey, locale),
		// Los meses de los controles de navegación: los calcula el servidor y
		// la vista se limita a enlazarlos (`?month=`).
		prevMonthKey: shiftMonth(monthKey, -1),
		nextMonthKey: shiftMonth(monthKey, 1),
		todayMonthKey: monthKeyOf(now, APP_TIME_ZONE),
		weekdays: weekdayLabels(locale),
		weeks: buildMonthGrid(monthKey, now, APP_TIME_ZONE),
		mealPlans,
		// Los gastos por día y el total del mes (tarea #220): la cabecera del
		// tab pinta el total y el grid cuelga la cifra de cada celda con
		// compras.
		purchasesByDay,
		expensesMonthTotal,
		// Las categorías de la familia: el select opcional de cada ingrediente
		// ofrece exactamente estas, como en el alta de items.
		categories: await listCategories(family.id),
		pantryItems,
		form: await superValidate(EMPTY_MEAL_PLAN, zod4(mealPlanFormSchema()))
	};
};

export const actions: Actions = {
	// Crear menú (#222): el schema valida título, día, tipo e ingredientes;
	// el día viaja como `YYYY-MM-DD` (`dayKeySchema`) y la despensa la
	// garantiza el SERVIDOR (`createMealPlan`: cada ingrediente crea su
	// producto con cantidad 0 si no estaba). El único (familia, fecha, tipo)
	// muere en P2002 y sale como `MealPlanExistsError`: se traduce al mensaje
	// genérico de la UI (patrón `stores`), sin filtrar el error crudo.
	// Tras crear, `invalidateAll: 'pessimistic'` en el cliente rerun el load
	// y el grid repinta el menú en su celda.
	create: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(mealPlanFormSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		try {
			await createMealPlan(family.id, form.data);
		} catch (error) {
			if (error instanceof MealPlanExistsError) {
				return message(form, m.meal_plan_exists(), { status: 409 });
			}
			logger.error({ err: error }, 'Error al crear el menú');
			// Fallo inesperado (BD caída, columna…): 5xx, que el cliente y la
			// monitorización lo vean como lo que es (issue #110).
			return message(form, m.meal_plan_error(), { status: 500 });
		}

		return message(form, m.meal_plan_success());
	},

	// Editar menú (#221): el modal de crear REUTILIZADO, precargado con el
	// menú del detalle del día. Valida el schema de editar (el de crear más
	// el id del menú, ver `schemas.ts`): el body llega como FormData con el
	// JSON troceado en `__superform_json` — la forma en que superforms viaja
	// los `dataType: 'json'` — y `superValidate(request, …)` lo junta solo.
	update: async (event) => {
		const family = requireActiveFamily(event);
		const form = await superValidate(event.request, zod4(mealPlanUpdateSchema()));
		if (!form.valid) {
			return fail(400, { form });
		}

		// El id ya validado se separa: al CRUD le llegan los MISMOS datos que
		// a `createMealPlan`. Si falta o va vacío (petición hecha a mano), el
		// aviso controlado dentro del modal — sin 500, como el resto de
		// basura de UI (ver `schemas.ts`).
		const { id, ...meal } = form.data;
		if (!id) {
			return message(form, m.meal_plan_gone(), { status: 400 });
		}

		try {
			// `updateMealPlan` solo toca menús DE LA FAMILIA ACTIVA: un id
			// ajeno o rancio llega como `false` — 404 controlado (issue #110),
			// no 500: la UI lo enseña dentro del modal como el resto de fallos.
			const updated = await updateMealPlan(family.id, id, meal);
			if (!updated) {
				return message(form, m.meal_plan_gone(), { status: 404 });
			}
		} catch (error) {
			if (error instanceof MealPlanExistsError) {
				// Mover (de tipo) el menú a un día+tipo ya ocupado: el mensaje
				// genérico, como en crear.
				return message(form, m.meal_plan_exists(), { status: 409 });
			}
			logger.error({ err: error }, 'Error al editar el menú');
			return message(form, m.meal_plan_error(), { status: 500 });
		}

		return message(form, m.meal_plan_updated());
	},

	// Borrar menú (#221): confirmación en la UI (ConfirmModal). Sin schema de
	// superforms (solo el id oculto), como el borrado de items. Un id ajeno
	// o de doble envío sale de `deleteMealPlan` como `false`: 404, que el
	// ConfirmModal pinta dentro de sí, sin 500.
	delete: async (event) => {
		const family = requireActiveFamily(event);
		const id = mealPlanIdOf(await event.request.formData());
		if (!id) {
			return fail(400, { error: m.meal_plan_error() });
		}

		try {
			const deleted = await deleteMealPlan(family.id, id);
			if (!deleted) {
				return fail(404, { error: m.meal_plan_gone() });
			}
		} catch (error) {
			logger.error({ err: error }, 'Error al borrar el menú');
			return fail(500, { error: m.meal_plan_error() });
		}

		return { success: true };
	}
};
