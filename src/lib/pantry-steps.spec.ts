import { describe, expect, it } from 'vitest';
import { Unit } from './generated/prisma/enums.js';
import { UNITS } from './schemas/item.js';
import { UNIT_STEP, redondearCantidad } from './pantry-steps.js';

describe('UNIT_STEP (#73)', () => {
	it('es el paso acordado en la issue: ud/paquete/lata/docena = 1, kg/L = 0,25, g/ml = 100', () => {
		expect(UNIT_STEP).toEqual({
			unit: 1,
			package: 1,
			can: 1,
			dozen: 1,
			kilogram: 0.25,
			liter: 0.25,
			gram: 100,
			milliliter: 100
		});
	});

	it('cubre exactamente el catálogo de unidades (el tipo ya lo exige; el spec lo canta en runtime)', () => {
		expect(Object.keys(UNIT_STEP).sort()).toEqual([...UNITS].sort());
		expect(Object.keys(UNIT_STEP).sort()).toEqual(Object.values(Unit).sort());
	});

	it('todos los pasos son mayores que cero: un click siempre cambia la cantidad', () => {
		for (const paso of Object.values(UNIT_STEP)) {
			expect(paso).toBeGreaterThan(0);
		}
	});
});

describe('redondearCantidad', () => {
	it('cierra el redondeo flotante a los 3 decimales de la columna', () => {
		expect(redondearCantidad(0.3 - 0.25)).toBe(0.05);
		expect(redondearCantidad(1.1 + 0.25)).toBe(1.35);
	});

	it('deja intactas las cantidades ya limpias', () => {
		expect(redondearCantidad(1.5)).toBe(1.5);
		expect(redondearCantidad(2)).toBe(2);
	});
});
