import { APP_TIME_ZONE } from '#lib/format.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import { requireActiveFamily } from '#lib/server/family-context.js';
import {
	buildMonthGrid,
	monthKeyOf,
	monthKeySchema,
	monthLabelOf,
	shiftMonth,
	weekdayLabels
} from './grid.js';
import type { PageServerLoad } from './$types';

// El esqueleto del calendario (épica #212, tarea #217): lectura pura, sin
// acciones. El mes en vista manda SIEMPRE en la query (`?month=YYYY-MM`) y
// se resuelve EN SERVIDOR — el cliente no calcula nada de fechas, solo pinta
// lo que trae el load. La familia activa es la puerta de la vista, como en
// listas, despensa e historial (issue #63): los datos por día llegarán con
// las vistas de gastos (#215) y menús (#216), colgando de las celdas del
// grid que aquí se calcula.
export const load: PageServerLoad = async (event) => {
	// El gate (302 a /families sin familia activa) y, desde aquí, el contexto
	// verificado para las queries futuras (#215/#216).
	requireActiveFamily(event);

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

	return {
		monthKey,
		monthLabel: monthLabelOf(monthKey, locale),
		// Los meses de los controles de navegación: los calcula el servidor y
		// la vista se limita a enlazarlos (`?month=`).
		prevMonthKey: shiftMonth(monthKey, -1),
		nextMonthKey: shiftMonth(monthKey, 1),
		todayMonthKey: monthKeyOf(now, APP_TIME_ZONE),
		weekdays: weekdayLabels(locale),
		weeks: buildMonthGrid(monthKey, now, APP_TIME_ZONE)
	};
};
