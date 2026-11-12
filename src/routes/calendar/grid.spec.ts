import { describe, expect, it } from 'vitest';
import {
	buildMonthGrid,
	dateKeyOf,
	monthKeyOf,
	monthKeySchema,
	monthLabelOf,
	shiftMonth,
	weekdayLabels
} from './grid.js';

// El cálculo del grid mensual del calendario (issue #217). Los instantes van
// fijados en UTC y las esperas, en la zona Europe/Madrid de la app
// (`APP_TIME_ZONE`): deterministas en cualquier máquina, como los de
// `format.spec.ts` — ni la zona ni la locale dependen del entorno que
// ejecute el spec.

const MADRID = 'Europe/Madrid';

describe('monthKeySchema', () => {
	it('acepta las claves bien formadas dentro del rango de años', () => {
		expect(monthKeySchema.safeParse('2026-11').success).toBe(true);
		expect(monthKeySchema.safeParse('1900-01').success).toBe(true);
		expect(monthKeySchema.safeParse('2099-12').success).toBe(true);
	});

	it('rechaza lo que no encaja con el patrón YYYY-MM', () => {
		expect(monthKeySchema.safeParse('26-11').success).toBe(false);
		expect(monthKeySchema.safeParse('2026-1').success).toBe(false);
		expect(monthKeySchema.safeParse('2026-11-05').success).toBe(false);
		expect(monthKeySchema.safeParse('noviembre').success).toBe(false);
		expect(monthKeySchema.safeParse('').success).toBe(false);
	});

	it('rechaza meses imposibles y años fuera del rango', () => {
		expect(monthKeySchema.safeParse('2026-00').success).toBe(false);
		expect(monthKeySchema.safeParse('2026-13').success).toBe(false);
		expect(monthKeySchema.safeParse('1899-12').success).toBe(false);
		expect(monthKeySchema.safeParse('2100-01').success).toBe(false);
	});

	it('rechaza lo que no es texto: la query puede no traer nada', () => {
		// `searchParams.get('month')` es `null` cuando falta el parámetro, y
		// el load cae entonces al mes actual.
		expect(monthKeySchema.safeParse(null).success).toBe(false);
		expect(monthKeySchema.safeParse(undefined).success).toBe(false);
	});
});

describe('buildMonthGrid', () => {
	it('trae siempre 6 semanas de 7 días, con las 42 fechas distintas y contiguas', () => {
		const weeks = buildMonthGrid('2027-02', new Date('2027-02-10T12:00:00Z'), MADRID);
		expect(weeks).toHaveLength(6);
		for (const week of weeks) expect(week).toHaveLength(7);

		const keys = weeks.flat().map((cell) => cell.dateKey);
		expect(new Set(keys).size).toBe(42);
	});

	it('cuadra un mes que empieza en DOMINGO (noviembre de 2026): relleno a la izquierda', () => {
		const weeks = buildMonthGrid('2026-11', new Date('2026-11-12T12:00:00Z'), MADRID);

		// La primera semana arranca el lunes 26 de octubre y cierra con el
		// domingo 1 de noviembre.
		expect(weeks[0][0]).toEqual({
			dateKey: '2026-10-26',
			day: 26,
			inMonth: false,
			isToday: false
		});
		expect(weeks[0][6]).toEqual({
			dateKey: '2026-11-01',
			day: 1,
			inMonth: true,
			isToday: false
		});

		// Noviembre termina en lunes 30: la última semana abre con él y
		// rellena hasta el domingo 6 de diciembre.
		expect(weeks[5][0]).toEqual({
			dateKey: '2026-11-30',
			day: 30,
			inMonth: true,
			isToday: false
		});
		expect(weeks[5][6]).toEqual({
			dateKey: '2026-12-06',
			day: 6,
			inMonth: false,
			isToday: false
		});

		// Los 30 días del mes, en orden y cada uno en su celda.
		const inMonth = weeks.flat().filter((cell) => cell.inMonth);
		expect(inMonth.map((cell) => cell.day)).toEqual(
			Array.from({ length: 30 }, (_, index) => index + 1)
		);
	});

	it('cuadra un mes que empieza en LUNES (febrero de 2027): sin relleno a la izquierda', () => {
		const weeks = buildMonthGrid('2027-02', new Date('2027-02-10T12:00:00Z'), MADRID);

		expect(weeks[0][0]).toEqual({
			dateKey: '2027-02-01',
			day: 1,
			inMonth: true,
			isToday: false
		});

		// 28 días: cuatro semanas exactas y el resto, celdas de marzo.
		expect(weeks[3][6]).toEqual({
			dateKey: '2027-02-28',
			day: 28,
			inMonth: true,
			isToday: false
		});
		expect(weeks[4][0]).toEqual({
			dateKey: '2027-03-01',
			day: 1,
			inMonth: false,
			isToday: false
		});

		const inMonth = weeks.flat().filter((cell) => cell.inMonth);
		expect(inMonth.map((cell) => cell.day)).toEqual(
			Array.from({ length: 28 }, (_, index) => index + 1)
		);
	});

	it('destaca «hoy» en la zona de la app, no en la del servidor', () => {
		// Mediodía del 12 de noviembre de 2026 UTC: en Madrid es el mismo día.
		const weeks = buildMonthGrid('2026-11', new Date('2026-11-12T12:00:00Z'), MADRID);
		expect(
			weeks
				.flat()
				.filter((cell) => cell.isToday)
				.map((cell) => cell.dateKey)
		).toEqual(['2026-11-12']);

		// El mismo día a las 23:30 UTC: en Madrid ya amanece el 13 (CET,
		// UTC+1) — el destacado se mueve con la zona aunque el servidor siga
		// en «12».
		const late = buildMonthGrid('2026-11', new Date('2026-11-12T23:30:00Z'), MADRID);
		expect(
			late
				.flat()
				.filter((cell) => cell.isToday)
				.map((cell) => cell.dateKey)
		).toEqual(['2026-11-13']);
	});
});

describe('monthKeyOf', () => {
	it('resuelve el mes del instante en la zona dada', () => {
		expect(monthKeyOf(new Date('2026-11-12T12:00:00Z'), MADRID)).toBe('2026-11');
	});

	it('se mueve con la zona: la última noche del mes ya es el mes siguiente en Madrid', () => {
		// 30 de noviembre a las 23:30 UTC: en Madrid son las 00:30 del 1 de
		// diciembre (CET), pero el servidor en UTC sigue en noviembre.
		expect(monthKeyOf(new Date('2026-11-30T23:30:00Z'), MADRID)).toBe('2026-12');
		expect(monthKeyOf(new Date('2026-11-30T23:30:00Z'), 'UTC')).toBe('2026-11');
	});
});

describe('dateKeyOf', () => {
	it('da la fecha del día en la zona dada, no en la del servidor', () => {
		expect(dateKeyOf(new Date('2026-11-12T23:30:00Z'), MADRID)).toBe('2026-11-13');
		expect(dateKeyOf(new Date('2026-11-12T23:30:00Z'), 'UTC')).toBe('2026-11-12');
	});
});

describe('shiftMonth', () => {
	it('mueve dentro del año en las dos direcciones', () => {
		expect(shiftMonth('2026-11', -1)).toBe('2026-10');
		expect(shiftMonth('2026-11', 1)).toBe('2026-12');
	});

	it('cruza el cambio de año en las dos direcciones', () => {
		expect(shiftMonth('2026-01', -1)).toBe('2025-12');
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
	});

	it('lanza con una clave que no sea YYYY-MM (solo viajan claves validadas)', () => {
		expect(() => shiftMonth('nov-2026', 1)).toThrow(RangeError);
	});
});

describe('monthLabelOf', () => {
	it('compone el título del mes con la convención de cada locale', () => {
		expect(monthLabelOf('2026-11', 'es')).toBe('noviembre de 2026');
		expect(monthLabelOf('2026-11', 'en')).toBe('November 2026');
	});
});

describe('weekdayLabels', () => {
	it('empieza la semana en lunes, con los nombres cortos de la locale', () => {
		expect(weekdayLabels('es')).toEqual(['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']);
		expect(weekdayLabels('en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
	});
});
