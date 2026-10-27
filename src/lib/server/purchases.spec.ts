import { describe, expect, it } from 'vitest';

// Test de UNIDAD (proyecto vitest `server`, sin base de datos): el contrato de
// `normalizeItemName`, el nombre canónico con el que la despensa decide si dos
// nombres escritos distinto son el mismo producto (issue #70).
import { normalizeItemName } from './purchases.js';

describe('normalizeItemName (#70)', () => {
	it('recorta los espacios sobrantes y pasa a minúsculas', () => {
		expect(normalizeItemName('  Leche Entera  ')).toBe('leche entera');
		expect(normalizeItemName('PAN')).toBe('pan');
	});

	it('quita los acentos: «Leche Desnatada» y «leche desnatada» son el mismo producto', () => {
		expect(normalizeItemName('Cañón de cerdo')).toBe(normalizeItemName('CANON DE CERDO'));
		expect(normalizeItemName(' Café molido ')).toBe(normalizeItemName('cafe molido'));
	});

	it('mantiene los espacios internos: es un nombre, no un slug', () => {
		expect(normalizeItemName('Aceite de oliva virgen')).toBe('aceite de oliva virgen');
	});

	it('colapsa la ñ a n, igual que el slugify de las familias', () => {
		expect(normalizeItemName('Ñoquis')).toBe('noquis');
	});

	it('un nombre de solo espacios deja la cadena vacía', () => {
		expect(normalizeItemName('   ')).toBe('');
	});
});
