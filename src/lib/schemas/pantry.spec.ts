import { describe, expect, it } from 'vitest';
import { PANTRY_MODES, readdSchema } from './pantry.js';

/** Datos válidos que el schema acepta, para mutar campo a campo en cada spec. */
const VALID = {
	listId: 'lista-1',
	quantity: 1,
	pantryMode: 'keep',
	newQuantity: undefined
} as const;

describe('readdSchema (#74)', () => {
	it('acepta dejar la despensa igual sin cantidad nueva', () => {
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

	it('rechaza modos fuera del catálogo', () => {
		const result = readdSchema().safeParse({ ...VALID, pantryMode: 'vender' });

		expect(result.success).toBe(false);
	});

	it('el catálogo es exactamente keep/set/remove', () => {
		expect([...PANTRY_MODES]).toEqual(['keep', 'set', 'remove']);
	});

	it('acepta cada modo del catálogo', () => {
		// «set» exige su cantidad nueva (lo corta el refine, con su propio
		// spec arriba); «keep» y «remove» valen sin ella.
		for (const pantryMode of ['keep', 'remove'] as const) {
			expect(readdSchema().safeParse({ ...VALID, pantryMode }).success).toBe(true);
		}
		expect(readdSchema().safeParse({ ...VALID, pantryMode: 'set', newQuantity: 1 }).success).toBe(
			true
		);
	});

	it('con «set» exige una cantidad nueva mayor que cero', () => {
		const setMode = { ...VALID, pantryMode: 'set' } as const;

		// Sin cantidad nueva, a cero o en negativo: el refine lo corta y señala
		// el campo `newQuantity` para que el formulario lo pinte bajo el input.
		for (const newQuantity of [undefined, 0, -0.5]) {
			const result = readdSchema().safeParse({ ...setMode, newQuantity });

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.path).toEqual(['newQuantity']);
			}
		}

		expect(readdSchema().safeParse({ ...setMode, newQuantity: 0.25 }).success).toBe(true);
	});

	it('la cantidad que queda en la despensa lleva el mismo contrato que la lista (#107)', () => {
		const setMode = { ...VALID, pantryMode: 'set' } as const;

		// La columna es DECIMAL(10,3) también en pantryItem: mismo mínimo, techo
		// y precisión que la cantidad del item.
		expect(readdSchema().safeParse({ ...setMode, newQuantity: 0.0001 }).success).toBe(false);
		expect(readdSchema().safeParse({ ...setMode, newQuantity: 1.2345 }).success).toBe(false);
		expect(readdSchema().safeParse({ ...setMode, newQuantity: 9_999_999.999 }).success).toBe(true);
	});

	it('con «keep» y «remove» ignora la cantidad nueva que venga', () => {
		expect(readdSchema().safeParse({ ...VALID, pantryMode: 'keep', newQuantity: 3 }).success).toBe(
			true
		);
		expect(
			readdSchema().safeParse({ ...VALID, pantryMode: 'remove', newQuantity: 3 }).success
		).toBe(true);
	});

	it('inyecta los mensajes del consumidor en los errores de cada campo', () => {
		const result = readdSchema({
			newQuantityError: 'Escribe la cantidad que queda'
		}).safeParse({ ...VALID, pantryMode: 'set', newQuantity: undefined });

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe('Escribe la cantidad que queda');
		}
	});
});
