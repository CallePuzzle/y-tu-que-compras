import { describe, expect, it } from 'vitest';
import { matchesItemSearch } from './item-search.js';

describe('matchesItemSearch (#208)', () => {
	const leche = { name: 'Leche entera', categoryName: 'Lácteos' };
	const telefono = { name: 'Teléfono fijo', categoryName: null };

	it('sin consulta (o de solo espacios) casa todo: el filtro está desactivado', () => {
		expect(matchesItemSearch(leche, '')).toBe(true);
		expect(matchesItemSearch(leche, '   ')).toBe(true);
	});

	it('subcadena contra el nombre, sin importar mayúsculas', () => {
		expect(matchesItemSearch(leche, 'leche')).toBe(true);
		expect(matchesItemSearch(leche, 'Leche')).toBe(true);
		expect(matchesItemSearch(leche, 'entera')).toBe(true);
		expect(matchesItemSearch(leche, 'leche entera')).toBe(true);
	});

	it('tolerante con acentos y espacios: buscar «telefono» encuentra «Teléfono fijo»', () => {
		expect(matchesItemSearch(telefono, 'telefono')).toBe(true);
		expect(matchesItemSearch(telefono, 'teléfono')).toBe(true);
		expect(matchesItemSearch(leche, 'leche  entera')).toBe(true);
	});

	it('casa también por la categoría: «lácteos» encuentra la leche', () => {
		expect(matchesItemSearch(leche, 'lacteos')).toBe(true);
		expect(matchesItemSearch(leche, 'LÁCTEOS')).toBe(true);
		expect(matchesItemSearch(leche, 'ác')).toBe(true);
	});

	it('sin categoría no rompe el match por nombre (ni casa categorías ajenas)', () => {
		expect(matchesItemSearch(telefono, 'telefono')).toBe(true);
		expect(matchesItemSearch(telefono, 'lacteos')).toBe(false);
	});

	it('sin coincidencia devuelve false', () => {
		expect(matchesItemSearch(leche, 'pescado')).toBe(false);
		// La subcadena debe estar EN el nombre, no compartir solo una letra.
		expect(matchesItemSearch(telefono, 'tv')).toBe(false);
	});
});
