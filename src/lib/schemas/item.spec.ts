import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zod4 } from 'sveltekit-superforms/adapters';
import { superValidate } from 'sveltekit-superforms/server';
import { describe, expect, it } from 'vitest';
import { Unit } from '../generated/prisma/enums.js';
import { itemSchema, UNITS, type ItemData } from './item.js';

/** Datos mínimos que el schema acepta, para mutar campo a campo en cada spec. */
const VALID = { name: 'Leche entera', quantity: 6, unit: 'unit' } as const;

describe('itemSchema', () => {
	it('acepta datos válidos y recorta el nombre', () => {
		const result = itemSchema().safeParse({ ...VALID, name: '  Leche entera  ' });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({ name: 'Leche entera', quantity: 6, unit: 'unit' });
		}
	});

	it('exige nombre: vacío o solo espacios no valida', () => {
		expect(itemSchema().safeParse({ ...VALID, name: '' }).success).toBe(false);
		expect(itemSchema().safeParse({ ...VALID, name: '   ' }).success).toBe(false);
	});

	it('limita el nombre a 100 caracteres, como la lista y la familia', () => {
		expect(itemSchema().safeParse({ ...VALID, name: 'a'.repeat(100) }).success).toBe(true);
		expect(itemSchema().safeParse({ ...VALID, name: 'a'.repeat(101) }).success).toBe(false);
	});

	it('exige cantidad mayor que cero: 0 y negativos no validan', () => {
		expect(itemSchema().safeParse({ ...VALID, quantity: 0 }).success).toBe(false);
		expect(itemSchema().safeParse({ ...VALID, quantity: -1.5 }).success).toBe(false);
	});

	it('rechaza lo que la columna DECIMAL(10,3) redondearía o desbordaría (#107)', () => {
		// Por debajo del mínimo: Postgres lo redondearía a 0 y el producto
		// llegaría a la despensa ya «Agotado».
		expect(itemSchema().safeParse({ ...VALID, quantity: 0.0001 }).success).toBe(false);
		// Techo exacto de la columna (10 dígitos, 3 decimales): por encima
		// desborda con «numeric field overflow» y la lista ya no se finaliza.
		expect(itemSchema().safeParse({ ...VALID, quantity: 9_999_999.999 }).success).toBe(true);
		expect(itemSchema().safeParse({ ...VALID, quantity: 10_000_000 }).success).toBe(false);
		// Cuarto decimal: la base lo redondearía por su cuenta; no se acepta.
		expect(itemSchema().safeParse({ ...VALID, quantity: 1.2345 }).success).toBe(false);
		// Múltiplos de la milésima hostiles a la coma flotante sí pasan.
		expect(itemSchema().safeParse({ ...VALID, quantity: 0.003 }).success).toBe(true);
		expect(itemSchema().safeParse({ ...VALID, quantity: 2.75 }).success).toBe(true);
	});

	it('acepta decimales: medio kilo es cantidad legal', () => {
		const result = itemSchema().safeParse({ ...VALID, quantity: 0.5, unit: 'kilogram' });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.quantity).toBe(0.5);
		}
	});

	it('rechaza una cantidad que no es número', () => {
		// El formulario viaja como texto en el FormData; superforms lo convierte
		// antes de validar, así que aquí solo pasa un number de verdad.
		expect(itemSchema().safeParse({ ...VALID, quantity: '6' }).success).toBe(false);
		expect(itemSchema().safeParse({ ...VALID, quantity: Number.NaN }).success).toBe(false);
	});

	it('rechaza unidades fuera del catálogo, con el mensaje inyectable', () => {
		const generic = itemSchema().safeParse({ ...VALID, unit: 'barril' });
		const custom = itemSchema({ unitError: 'Elige una unidad' }).safeParse({
			...VALID,
			unit: 'barril'
		});

		expect(generic.success).toBe(false);
		expect(custom.success).toBe(false);
		if (!generic.success && !custom.success) {
			// El texto que llega al formulario es el que inyecta el consumidor.
			expect(custom.error.issues[0]?.message).toBe('Elige una unidad');
		}
	});

	it('acepta cada unidad del catálogo', () => {
		for (const unit of UNITS) {
			expect(itemSchema().safeParse({ ...VALID, unit }).success).toBe(true);
		}
	});

	it('está lista para superforms: los errores llegan al formulario', async () => {
		// Con el formulario vacío por defecto superforms no pinta errores (solo
		// marca `valid: false`); con datos inválidos sí los devuelve por campo.
		// El enum no tipa valores fuera de catálogo, así que el molde es explícito.
		const badData = { name: '', quantity: 0, unit: 'barril' } as unknown as ItemData;
		const invalid = await superValidate(
			badData,
			zod4(
				itemSchema({
					nameError: 'Pon nombre',
					quantityError: 'Cantidad mayor que cero',
					unitError: 'Elige una unidad'
				})
			)
		);

		expect(invalid.valid).toBe(false);
		expect(invalid.errors.name).toEqual(['Pon nombre']);
		expect(invalid.errors.quantity).toEqual(['Cantidad mayor que cero']);
		expect(invalid.errors.unit).toEqual(['Elige una unidad']);

		const filled = await superValidate({ ...VALID }, zod4(itemSchema()));

		expect(filled.valid).toBe(true);
		expect(filled.data).toEqual({ ...VALID });
	});
});

describe('UNITS', () => {
	it('son exactamente las ocho unidades de la issue #67', () => {
		expect([...UNITS].sort()).toEqual(
			['can', 'dozen', 'gram', 'kilogram', 'liter', 'milliliter', 'package', 'unit'].sort()
		);
	});

	it('coincide con el enum `unit` del cliente Prisma generado', () => {
		// Mismo contrato al validar y al almacenar: si alguien añade una unidad
		// en un lado sin el otro, este spec lo canta antes que la base de datos.
		expect([...UNITS].sort()).toEqual(Object.values(Unit).sort());
	});
});

describe('etiquetas de unidades', () => {
	// El enum no se muestra tal cual (issue #67): la UI resuelve la etiqueta
	// con las claves `unit_*` de Paraglide. Que existan para TODAS las unidades
	// y en AMBOS idiomas es parte del criterio de aceptación.
	for (const locale of ['es', 'en'] as const) {
		it(`cada unidad y cada texto del schema tienen etiqueta en ${locale}`, () => {
			const messages = JSON.parse(
				readFileSync(
					fileURLToPath(new URL(`../../../messages/${locale}.json`, import.meta.url)),
					'utf8'
				)
			) as Record<string, string>;

			for (const unit of UNITS) {
				const label = messages[`unit_${unit}`];
				expect(
					typeof label === 'string' && label.length > 0,
					`falta «unit_${unit}» en messages/${locale}.json`
				).toBe(true);
			}

			for (const key of [
				'schema_items_name_label',
				'schema_items_name_placeholder',
				'schema_items_name_error',
				'schema_items_quantity_label',
				'schema_items_quantity_error',
				'schema_items_unit_label',
				'schema_items_unit_error'
			]) {
				expect(
					typeof messages[key] === 'string' && messages[key].length > 0,
					`falta «${key}» en messages/${locale}.json`
				).toBe(true);
			}
		});
	}
});
