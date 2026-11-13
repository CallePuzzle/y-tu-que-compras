import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MealType } from '../generated/prisma/enums.js';
import { MEAL_TYPES, dayKeySchema, mealPlanSchema } from './mealplan.js';

/** Datos mínimos que el schema acepta, para mutar campo a campo en cada spec. */
const VALID = {
	title: 'Lentejas con verduras',
	date: '2026-03-10',
	mealType: 'lunch',
	ingredients: [{ name: 'Lentejas pardinas', quantity: 0.5, unit: 'kilogram' }]
} as const;

describe('mealPlanSchema', () => {
	it('acepta datos válidos y recorta título y nombre del ingrediente', () => {
		const result = mealPlanSchema().safeParse({
			...VALID,
			title: `  ${VALID.title}  `,
			ingredients: [{ name: '  Lentejas pardinas  ', quantity: 0.5, unit: 'kilogram' }]
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.title).toBe(VALID.title);
			expect(result.data.ingredients[0]?.name).toBe('Lentejas pardinas');
		}
	});

	it('exige título: vacío o solo espacios no valida; máximo 100, como el nombre del item', () => {
		expect(mealPlanSchema().safeParse({ ...VALID, title: '' }).success).toBe(false);
		expect(mealPlanSchema().safeParse({ ...VALID, title: '   ' }).success).toBe(false);
		expect(mealPlanSchema().safeParse({ ...VALID, title: 'a'.repeat(100) }).success).toBe(true);
		expect(mealPlanSchema().safeParse({ ...VALID, title: 'a'.repeat(101) }).success).toBe(false);
	});

	it('exige nombre de ingrediente: vacío o solo espacios no valida', () => {
		const blank = {
			name: '   ',
			quantity: 1,
			unit: 'unit'
		};
		expect(mealPlanSchema().safeParse({ ...VALID, ingredients: [blank] }).success).toBe(false);
	});

	it('acepta un menú SIN ingredientes: un menú válido no lleva producto garantizado', () => {
		const result = mealPlanSchema().safeParse({ ...VALID, ingredients: [] });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.ingredients).toEqual([]);
		}
	});

	it('rechaza un tipo de comida fuera del catálogo y acepta cada uno del catálogo', () => {
		expect(mealPlanSchema().safeParse({ ...VALID, mealType: 'brunch' }).success).toBe(false);
		for (const mealType of MEAL_TYPES) {
			expect(mealPlanSchema().safeParse({ ...VALID, mealType }).success).toBe(true);
		}
	});

	it('acepta categoryId opcional: ausente y vacío («Sin categoría») validan', () => {
		const withoutCategory = {
			name: 'Cebolla',
			quantity: 2,
			unit: 'unit'
		};
		const absent = mealPlanSchema().safeParse({ ...VALID, ingredients: [withoutCategory] });
		expect(absent.success).toBe(true);
		if (absent.success) {
			expect(absent.data.ingredients[0]?.categoryId).toBeUndefined();
		}

		const empty = mealPlanSchema().safeParse({
			...VALID,
			ingredients: [{ ...withoutCategory, categoryId: '' }]
		});
		expect(empty.success).toBe(true);
		if (empty.success) {
			expect(empty.data.ingredients[0]?.categoryId).toBe('');
		}
	});

	it('la cantidad de un ingrediente comparte el contrato exacto de la columna (#107)', () => {
		const withQuantity = (quantity: unknown) =>
			mealPlanSchema().safeParse({
				...VALID,
				ingredients: [{ name: 'Cebolla', quantity, unit: 'unit' }]
			}).success;

		// 0 y negativos no validan (mínimo una milésima).
		expect(withQuantity(0)).toBe(false);
		expect(withQuantity(-1.5)).toBe(false);
		// Lo que la base redondearía por su cuenta, tampoco.
		expect(withQuantity(0.0001)).toBe(false);
		expect(withQuantity(1.2345)).toBe(false);
		// Techo exacto de la DECIMAL(10,3); por encima, desbordamiento.
		expect(withQuantity(9_999_999.999)).toBe(true);
		expect(withQuantity(10_000_000)).toBe(false);
		// Múltiplos de la milésima hostiles a la coma flotante sí pasan.
		expect(withQuantity(0.003)).toBe(true);
		expect(withQuantity(2.75)).toBe(true);
	});
});

describe('dayKeySchema', () => {
	it('acepta una fecha real en formato YYYY-MM-DD', () => {
		expect(dayKeySchema().safeParse('2026-03-10').success).toBe(true);
	});

	it('rechaza días inexistentes aunque el parseo ISO los ruede al mes siguiente', () => {
		// El parseo ISO de Date hace ROLLOVER, no invalida: 2026-02-31 es para
		// JS el 1 de marzo y getTime() no da NaN. Sin round-trip, el menú se
		// guardaría en un día distinto al elegido (a veces en otro mes).
		expect(dayKeySchema().safeParse('2026-02-31').success).toBe(false);
		expect(dayKeySchema().safeParse('2026-02-30').success).toBe(false);
		expect(dayKeySchema().safeParse('2026-04-31').success).toBe(false);
		// El 29 de febrero solo existe en años bisiestos.
		expect(dayKeySchema().safeParse('2026-02-29').success).toBe(false);
		expect(dayKeySchema().safeParse('2028-02-29').success).toBe(true);
	});

	it('rechaza claves sin formato, con mes imposible o fuera del calendario navegable', () => {
		expect(dayKeySchema().safeParse('basura').success).toBe(false);
		expect(dayKeySchema().safeParse('2026-3-1').success).toBe(false);
		expect(dayKeySchema().safeParse('2026-13-01').success).toBe(false);
		expect(dayKeySchema().safeParse('2026-00-10').success).toBe(false);
		// La cota de años replica a `monthKeySchema` del grid (1900–2099).
		expect(dayKeySchema().safeParse('0099-12-01').success).toBe(false);
		expect(dayKeySchema().safeParse('2100-01-01').success).toBe(false);
	});
});

describe('MEAL_TYPES', () => {
	it('son exactamente los cuatro tipos de comida de la épica #212', () => {
		expect([...MEAL_TYPES]).toEqual(['breakfast', 'lunch', 'dinner', 'other']);
	});

	it('coincide con el enum `mealType` del cliente Prisma generado', () => {
		// Mismo contrato al validar y al almacenar: si alguien añade un tipo en
		// un lado sin el otro, este spec lo canta antes que la base de datos.
		expect([...MEAL_TYPES].sort()).toEqual(Object.values(MealType).sort());
	});
});

describe('etiquetas del schema de menú', () => {
	// El enum no se muestra tal cual: la UI resuelve la etiqueta con las
	// claves `meal_*` de Paraglide, que llegan con la vista de menú (#215).
	// Este spec se ampliará entonces; hoy solo se canta lo que YA debe existir.
	for (const locale of ['es', 'en'] as const) {
		it(`las claves unit_* siguen presentes en ${locale} (las comparte el ingrediente)`, () => {
			const messages = JSON.parse(
				readFileSync(
					fileURLToPath(new URL(`../../../messages/${locale}.json`, import.meta.url)),
					'utf8'
				)
			) as Record<string, string>;

			expect(typeof messages.unit_unit === 'string' && messages.unit_unit.length > 0).toBe(true);
		});
	}
});
