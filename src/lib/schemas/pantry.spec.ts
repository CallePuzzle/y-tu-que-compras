import { describe, expect, it } from 'vitest';
import { UNITS } from './item.js';
import { editSchema, readdSchema } from './pantry.js';

/** Datos válidos que el schema acepta, para mutar campo a campo en cada spec. */
const VALID = { listId: 'lista-1', quantity: 1 } as const;

/** Datos válidos que el schema de edición acepta, para mutar campo a campo. */
const EDIT_VALID = { quantity: 1, unit: 'kilogram' } as const;

describe('readdSchema (#74, #149)', () => {
	it('acepta lista y cantidad, sin nada más que preguntar (#149)', () => {
		const result = readdSchema().safeParse(VALID);

		expect(result.success).toBe(true);
	});

	it('exige lista de destino', () => {
		expect(readdSchema().safeParse({ ...VALID, listId: '' }).success).toBe(false);
		expect(readdSchema().safeParse({ ...VALID, listId: undefined }).success).toBe(false);
	});

	it('exige cantidad para la lista mayor que cero', () => {
		expect(readdSchema().safeParse({ ...VALID, quantity: 0 }).success).toBe(false);
		expect(readdSchema().safeParse({ ...VALID, quantity: -2 }).success).toBe(false);
	});

	it('la cantidad de la lista lleva el contrato de DECIMAL(10,3) (#107)', () => {
		// El mismo rango que el item: mínimo una milésima, techo de columna y
		// múltiplo de la milésima.
		expect(readdSchema().safeParse({ ...VALID, quantity: 0.0001 }).success).toBe(false);
		expect(readdSchema().safeParse({ ...VALID, quantity: 10_000_000 }).success).toBe(false);
		expect(readdSchema().safeParse({ ...VALID, quantity: 1.2345 }).success).toBe(false);
		expect(readdSchema().safeParse({ ...VALID, quantity: 0.001 }).success).toBe(true);
	});

	it('inyecta los mensajes del consumidor en los errores de cada campo', () => {
		const result = readdSchema({ listIdError: 'Elige una lista' }).safeParse({
			...VALID,
			listId: ''
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe('Elige una lista');
		}
	});
});

describe('editSchema (#249)', () => {
	it('acepta cantidad y unidad, sin nada más que preguntar', () => {
		expect(editSchema().safeParse(EDIT_VALID).success).toBe(true);
	});

	it('la unidad es del catálogo, ni una más', () => {
		expect(editSchema().safeParse({ ...EDIT_VALID, unit: 'litro' }).success).toBe(false);
		expect(editSchema().safeParse({ ...EDIT_VALID, unit: undefined }).success).toBe(false);
		for (const unit of UNITS) {
			expect(editSchema().safeParse({ ...EDIT_VALID, unit }).success).toBe(true);
		}
	});

	// El agotado NO va por aquí (#249): se consume hasta 0 y de ahí se
	// re-añade o se quita — editar a cantidad 0 no existe.
	it('la cantidad no puede ser 0 ni negativa (contrato #107)', () => {
		expect(editSchema().safeParse({ ...EDIT_VALID, quantity: 0 }).success).toBe(false);
		expect(editSchema().safeParse({ ...EDIT_VALID, quantity: -2 }).success).toBe(false);
	});

	it('la cantidad lleva el contrato de DECIMAL(10,3) (#107)', () => {
		// El mismo rango que el item: mínimo una milésima, techo de columna y
		// múltiplo de la milésima.
		expect(editSchema().safeParse({ ...EDIT_VALID, quantity: 0.0001 }).success).toBe(false);
		expect(editSchema().safeParse({ ...EDIT_VALID, quantity: 10_000_000 }).success).toBe(false);
		expect(editSchema().safeParse({ ...EDIT_VALID, quantity: 1.2345 }).success).toBe(false);
		expect(editSchema().safeParse({ ...EDIT_VALID, quantity: 0.001 }).success).toBe(true);
	});

	it('inyecta los mensajes del consumidor en los errores de cada campo', () => {
		const quantity = editSchema({ quantityError: 'Cantidad inválida' }).safeParse({
			...EDIT_VALID,
			quantity: 0
		});
		expect(quantity.success).toBe(false);
		if (!quantity.success) {
			expect(quantity.error.issues[0]?.message).toBe('Cantidad inválida');
		}

		const unit = editSchema({ unitError: 'Unidad inválida' }).safeParse({
			...EDIT_VALID,
			unit: 'litro'
		});
		expect(unit.success).toBe(false);
		if (!unit.success) {
			expect(unit.error.issues[0]?.message).toBe('Unidad inválida');
		}
	});
});
