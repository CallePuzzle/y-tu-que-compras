import { describe, expect, it } from 'vitest';
import { readdSchema } from './pantry.js';

/** Datos válidos que el schema acepta, para mutar campo a campo en cada spec. */
const VALID = { listId: 'lista-1', quantity: 1 } as const;

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
