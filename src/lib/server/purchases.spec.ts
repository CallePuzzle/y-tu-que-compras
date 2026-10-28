import { describe, expect, it } from 'vitest';

// Test unitario (proyecto `server`, sin base de datos) del contrato del nombre
// canónico de la despensa: es la clave con la que `PantryItem` decide si dos
// escrituras son el mismo producto y hay que SUMAR (issues #70 y #107).

import { normalizeItemName } from './purchases.js';

describe('normalizeItemName (#70, #107)', () => {
	it('pone en minúsculas y quita acentos: el acento y la mayúscula no hacen al producto', () => {
		expect(normalizeItemName('Leche Entera')).toBe('leche entera');
		expect(normalizeItemName('LECHE entera')).toBe('leche entera');
		expect(normalizeItemName('Café con leche')).toBe('cafe con leche');
		expect(normalizeItemName('Aceítunas')).toBe('aceitunas');
	});

	it('recorta los espacios de los extremos', () => {
		expect(normalizeItemName('  pan de molde  ')).toBe('pan de molde');
		expect(normalizeItemName('\tLeche\n')).toBe('leche');
	});

	it('colapsa los espacios internos repetidos (issue #107)', () => {
		// Antes «Leche  entera» y «Leche entera» creaban DOS filas de despensa
		// que no se sumaban al re-añadir: ahora canónicamente son la misma.
		expect(normalizeItemName('Leche  entera')).toBe('leche entera');
		expect(normalizeItemName('Leche \t entera')).toBe('leche entera');
		expect(normalizeItemName('Leche  Entera')).toBe(normalizeItemName('leche entera'));
	});

	it('no es un slug: conserva los espacios simples entre palabras', () => {
		expect(normalizeItemName('Pan de molde')).toBe('pan de molde');
	});

	it('el resultado vacío solo si la entrada es vacía o de espacios', () => {
		expect(normalizeItemName('')).toBe('');
		expect(normalizeItemName('   ')).toBe('');
	});
});
