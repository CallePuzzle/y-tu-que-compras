import { z } from 'zod/v4';

// Cálculo del grid mensual del calendario (épica #212, tarea #217):
// funciones PURAS, sin Paraglide ni imports de servidor, para que las pruebe
// el proyecto `server` de vitest (como `#lib/format.js`). El mes en vista
// viaja como clave `YYYY-MM` — validada en el servidor con `monthKeySchema`
// — y «hoy» se resuelve SIEMPRE en la zona horaria que le pasa quien llama
// (la de la app, `APP_TIME_ZONE`): sin fijarla, un servidor en UTC destacaría
// como «hoy» el día equivocado entre las 00:00 y las 02:00 de Madrid.

/** Las semanas que SIEMPRE pinta el grid: 6×7 = 42 celdas, sobre o bajo. */
const GRID_WEEKS = 6;

/**
 * El rango de años que acepta una clave de mes. No es capricho: `Date.UTC`
 * mapea los años 0–99 al siglo XX (herencia de las fechas de dos cifras de
 * C89) y el calendario de la app no necesita salirse de 1900–2099 — dentro
 * de ese rango la aritmética UTC es directa y sin sorpresas.
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2099;

/** El formato estricto de una clave de mes: año de 4 cifras y mes 01–12. */
const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Una celda del grid mensual: el día que pinta y sus marcas. `dateKey`
 * (`YYYY-MM-DD`) es la clave que unirá cada celda con sus datos cuando la
 * épica los traiga: los gastos del día (#215) y los eventos de menú (#216)
 * llegan indexados por fecha, igual que viaja el mes en la query.
 */
export interface CalendarCell {
	/** La fecha como `YYYY-MM-DD`. */
	dateKey: string;
	/** El número de día (1–31), listo para pintar. */
	day: number;
	/** ¿Pertenece al mes en vista? Los rellenos del mes contiguo van atenuados. */
	inMonth: boolean;
	/** ¿Es «hoy» en la zona horaria de la vista? */
	isToday: boolean;
}

/**
 * ¿Es una clave de mes válida (`YYYY-MM`, año 1900–2099)? La usa el schema
 * de zod y `parseMonthKey`: una sola definición de «clave buena».
 */
export function isMonthKey(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const match = MONTH_KEY_PATTERN.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * El schema de `?month=` (issue #217): una clave `YYYY-MM` de verdad. El
 * load distingue con él «ausente o basura» (cae al mes actual) de una clave
 * bien formada — el query param nunca se confía, igual que los offsets del
 * historial (#109).
 */
export const monthKeySchema = z.string().refine(isMonthKey);

/**
 * Parte una clave VALIDADA en sus números (el mes queda 1–12, como en la
 * clave). Lanza con una clave ajena al formato: solo se llama con claves
 * salidas de `monthKeySchema` o de `shiftMonth`.
 */
function parseMonthKey(monthKey: string): { year: number; month: number } {
	if (!isMonthKey(monthKey)) throw new RangeError(`Clave de mes inválida: ${monthKey}`);
	return { year: Number(monthKey.slice(0, 4)), month: Number(monthKey.slice(5, 7)) };
}

/** Dos cifras con cero a la izquierda (`3` → `03`). */
function pad2(value: number): string {
	return String(value).padStart(2, '0');
}

/** Una parte de `formatToParts`, garantizada por haberla pedido al formatear. */
function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
	const value = parts.find((part) => part.type === type)?.value;
	if (value === undefined) throw new RangeError(`Intl no devolvió la parte ${type}`);
	return value;
}

/**
 * La fecha de un instante en la zona horaria dada, como `YYYY-MM-DD`. Va en
 * locale `en` porque es una CLAVE interna (para comparar y indexar), no un
 * texto para pintar: en `en` los dígitos y el orden año-mes-día son
 * estables, y las partes (no el formato) son las que componen la clave.
 */
export function dateKeyOf(date: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date);
	return `${partOf(parts, 'year')}-${partOf(parts, 'month')}-${partOf(parts, 'day')}`;
}

/**
 * El mes de un instante, resuelto en la zona horaria dada: el «ahora» del
 * servidor (suele ir en UTC) no siempre cae en el mismo mes que el del
 * usuario de Madrid, y el mes actual del calendario es el DE LA APP.
 */
export function monthKeyOf(date: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone,
		year: 'numeric',
		month: '2-digit'
	}).formatToParts(date);
	return `${partOf(parts, 'year')}-${partOf(parts, 'month')}`;
}

/**
 * El mes anterior o siguiente de una clave validada (`delta` en meses, con
 * negativo para atrás). La aritmética de `Date` normaliza los desbordes:
 * mes 13 es enero del año siguiente y mes 0, diciembre del anterior.
 */
export function shiftMonth(monthKey: string, delta: number): string {
	const { year, month } = parseMonthKey(monthKey);
	const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
	return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}`;
}

/**
 * El grid del mes: SIEMPRE 6 semanas × 7 días, la semana empezando en
 * lunes. Los huecos de la primera y la última semana se rellenan con los
 * días contiguos del mes anterior/siguiente (la vista los atenúa), y cada
 * celda lleva su `dateKey` para que las vistas de la épica cuelguen de ella
 * los datos del día.
 */
export function buildMonthGrid(monthKey: string, now: Date, timeZone: string): CalendarCell[][] {
	const { year, month } = parseMonthKey(monthKey);
	const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
	// El desplazamiento hasta el lunes de la primera semana: lunes = 0 …
	// domingo = 6 (`getUTCDay` cuenta domingo = 0 … sábado = 6).
	const mondayOffset = (firstOfMonth.getUTCDay() + 6) % 7;
	const todayKey = dateKeyOf(now, timeZone);

	const cells: CalendarCell[] = [];
	for (let index = 0; index < GRID_WEEKS * 7; index += 1) {
		// `setUTCDate` normaliza los días ≤ 0 y los que desbordan el mes:
		// ahí viven, sin aritmética a mano, los rellenos del mes contiguo.
		const date = new Date(firstOfMonth);
		date.setUTCDate(1 - mondayOffset + index);
		const dateKey = dateKeyOf(date, 'UTC');
		cells.push({
			dateKey,
			day: date.getUTCDate(),
			inMonth: date.getUTCMonth() === month - 1,
			isToday: dateKey === todayKey
		});
	}

	return Array.from({ length: GRID_WEEKS }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/**
 * El título del mes («noviembre de 2026» en es, «November 2026» en en): se
 * compone EN SERVIDOR con la locale de la petición (regla i18n), como las
 * fechas del historial. `timeZone: 'UTC'` sobre la medianoche UTC del día 1:
 * sin él, una zona al este del meridiano desplazaría el título al mes
 * siguiente.
 */
export function monthLabelOf(monthKey: string, locale: string): string {
	const { year, month } = parseMonthKey(monthKey);
	return new Intl.DateTimeFormat(locale, {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * Los nombres cortos de los días de la semana según la locale, SEMANA
 * EMPEZANDO EN LUNES («lun»–«dom» en es, «Mon»–«Sun» en en): la cabecera
 * del grid. Ancla fija cualquiera que sea lunes (el 2 de enero de 2017 en
 * UTC): solo importan los nombres, no la fecha.
 */
export function weekdayLabels(locale: string): string[] {
	const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
	const monday = Date.UTC(2017, 0, 2);
	return Array.from({ length: 7 }, (_, index) =>
		formatter.format(new Date(monday + index * 24 * 60 * 60 * 1000))
	);
}
