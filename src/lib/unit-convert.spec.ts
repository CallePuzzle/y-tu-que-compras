import { describe, expect, it } from 'vitest';
import { UNITS } from '#lib/schemas/item.js';
import { convertQuantity, findUnitConflicts, type PantryProduct } from './unit-convert.js';

describe('convertQuantity (#240)', () => {
	it('escala kg↔g y L↔ml en los DOS sentidos', () => {
		expect(convertQuantity(0.3, 'kilogram', 'gram')).toBe(300);
		expect(convertQuantity(300, 'gram', 'kilogram')).toBe(0.3);
		expect(convertQuantity(2, 'liter', 'milliliter')).toBe(2000);
		expect(convertQuantity(1500, 'milliliter', 'liter')).toBe(1.5);
	});

	it('bordes de precisión en DECIMAL(10,3): 1 g → 0,001 kg y 250 g → 0,25 kg', () => {
		expect(convertQuantity(1, 'gram', 'kilogram')).toBe(0.001);
		expect(convertQuantity(250, 'gram', 'kilogram')).toBe(0.25);
		expect(convertQuantity(1, 'milliliter', 'liter')).toBe(0.001);
	});

	it('docena→ud multiplica por 12 y siempre cabe (exacta)', () => {
		expect(convertQuantity(1.5, 'dozen', 'unit')).toBe(18);
		// 0,001 docena son 0,012 ud: la última milésima que la columna aguanta.
		expect(convertQuantity(0.001, 'dozen', 'unit')).toBe(0.012);
	});

	it('ud→docena NO está en la matriz: aviso informativo sin botón', () => {
		// En general 1 ud son 0,083… docenas (no cabe en 3 decimales)…
		expect(convertQuantity(24, 'unit', 'dozen')).toBeNull();
		// …y ni siquiera el caso redondo (12 ud = 1 docena) convierte: la
		// decisión es del PAR (decisión de la tarea), no de la cantidad.
		expect(convertQuantity(12, 'unit', 'dozen')).toBeNull();
	});

	it('paquete, lata y pares sin pivote (kg↔L) no convierten', () => {
		expect(convertQuantity(2, 'package', 'unit')).toBeNull();
		expect(convertQuantity(2, 'can', 'unit')).toBeNull();
		expect(convertQuantity(2, 'kilogram', 'liter')).toBeNull();
	});

	it('devuelve null cuando el resultado no es múltiplo de 0,001', () => {
		// 0,25 g son 0,00025 kg: la columna lo redondearía por su cuenta.
		expect(convertQuantity(0.25, 'gram', 'kilogram')).toBeNull();
		expect(convertQuantity(1.5, 'gram', 'kilogram')).toBeNull();
		expect(convertQuantity(0.5, 'milliliter', 'liter')).toBeNull();
		// Hacia ARRIBA no hay pérdida: la misma cantidad en kg sí escala.
		expect(convertQuantity(1.001, 'kilogram', 'gram')).toBe(1001);
	});

	it('la misma unidad devuelve la cantidad tal cual (normalizada a 3 decimales)', () => {
		expect(convertQuantity(2.5, 'gram', 'gram')).toBe(2.5);
		expect(convertQuantity(0.3, 'kilogram', 'kilogram')).toBeCloseTo(0.3, 10);
	});

	it('lo no finito o no positivo no convierte (la fila puede estar a medias)', () => {
		expect(convertQuantity(0, 'gram', 'kilogram')).toBeNull();
		expect(convertQuantity(-1, 'gram', 'kilogram')).toBeNull();
		expect(convertQuantity(Number.NaN, 'gram', 'kilogram')).toBeNull();
	});

	it('la matriz entera: fuera de kg↔g, L↔ml, docena→ud y la identidad, nada convierte', () => {
		const MATRIZ = new Set([
			'kilogram:gram',
			'gram:kilogram',
			'liter:milliliter',
			'milliliter:liter',
			'dozen:unit'
		]);
		for (const from of UNITS) {
			for (const to of UNITS) {
				const converted = convertQuantity(1, from, to);
				if (from === to) {
					expect(converted).toBe(1);
				} else if (MATRIZ.has(`${from}:${to}`)) {
					expect(converted).not.toBeNull();
				} else {
					expect(converted).toBeNull();
				}
			}
		}
	});
});

describe('findUnitConflicts (#240)', () => {
	const despensa: PantryProduct[] = [
		{ id: 'arroz-kg', name: 'Arroz', unit: 'kilogram' },
		{ id: 'leche', name: 'Leche entera', unit: 'liter' },
		{ id: 'pan', name: 'Pan de molde', unit: 'package' },
		{ id: 'arroz-docena', name: 'Arroz', unit: 'dozen' }
	];

	it('mismo nombre canónico y unidad distinta: «arroz» en g ve «Arroz» en kg', () => {
		const conflicts = findUnitConflicts('arroz', 'gram', despensa);
		expect(conflicts).toHaveLength(2);
		expect(conflicts.map((product) => product.id)).toEqual(['arroz-kg', 'arroz-docena']);
	});

	it('mismo nombre y MISMA unidad no es conflicto; otra unidad del mismo producto, sí', () => {
		// Con la fila en kg solo choca el otro «Arroz» (en docena): el de kg no.
		expect(findUnitConflicts('Arroz', 'kilogram', despensa)).toEqual([
			{ id: 'arroz-docena', name: 'Arroz', unit: 'dozen' }
		]);
	});

	it('normaliza como el resto de la app: mayúsculas, acentos y espacios de más', () => {
		const despensaAcentos: PantryProduct[] = [
			{ id: 'cafe', name: 'Café molido', unit: 'kilogram' }
		];
		expect(findUnitConflicts('cafe  molido', 'gram', despensaAcentos)).toEqual([
			{ id: 'cafe', name: 'Café molido', unit: 'kilogram' }
		]);
	});

	it('otro nombre no conflictúa, aunque comparta palabras', () => {
		expect(findUnitConflicts('arroz integral', 'gram', despensa)).toEqual([]);
	});

	it('nombre vacío (fila sin teclear) no encuentra nada', () => {
		expect(findUnitConflicts('', 'gram', despensa)).toEqual([]);
		expect(findUnitConflicts('   ', 'gram', despensa)).toEqual([]);
	});

	it('despensa vacía: sin conflictos, sin aviso', () => {
		expect(findUnitConflicts('arroz', 'gram', [])).toEqual([]);
	});
});
