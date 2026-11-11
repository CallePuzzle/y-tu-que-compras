import { beforeEach, describe, expect, it } from 'vitest';

import {
	createPantryCollapse,
	PANTRY_COLLAPSED_STORAGE_KEY,
	readPantryCollapsedKeys
} from './pantry-collapse.js';

beforeEach(() => {
	localStorage.removeItem(PANTRY_COLLAPSED_STORAGE_KEY);
});

describe('readPantryCollapsedKeys', () => {
	it('sin clave guardada no hay secciones colapsadas', () => {
		expect(readPantryCollapsedKeys().size).toBe(0);
	});

	it('lee las claves guardadas y las ignora no-string', () => {
		localStorage.setItem(PANTRY_COLLAPSED_STORAGE_KEY, JSON.stringify(['casa-1', 'fuera-2', 3]));
		expect(readPantryCollapsedKeys()).toEqual(new Set(['casa-1', 'fuera-2']));
	});

	it('un JSON corrupto se trata como ausente (no revienta la despensa)', () => {
		localStorage.setItem(PANTRY_COLLAPSED_STORAGE_KEY, '{not-json');
		expect(readPantryCollapsedKeys().size).toBe(0);
	});

	it('una forma inesperada (no array) también', () => {
		localStorage.setItem(PANTRY_COLLAPSED_STORAGE_KEY, JSON.stringify({ 'casa-1': true }));
		expect(readPantryCollapsedKeys().size).toBe(0);
	});
});

describe('createPantryCollapse', () => {
	it('por defecto todo expandido; alternar colapsa y persiste', () => {
		const state = createPantryCollapse();
		expect(state.isCollapsed('casa-1')).toBe(false);

		state.toggle('casa-1');
		expect(state.isCollapsed('casa-1')).toBe(true);
		expect(state.isCollapsed('fuera-1')).toBe(false);
		expect(JSON.parse(localStorage.getItem(PANTRY_COLLAPSED_STORAGE_KEY) ?? 'null')).toEqual([
			'casa-1'
		]);

		// Una instancia nueva (una recarga) retoma el estado guardado.
		expect(createPantryCollapse().isCollapsed('casa-1')).toBe(true);
	});

	it('des-colapsar retira la clave y vacía el storage al no quedar ninguna', () => {
		localStorage.setItem(PANTRY_COLLAPSED_STORAGE_KEY, JSON.stringify(['casa-1', 'fuera-1']));
		const state = createPantryCollapse();

		state.toggle('casa-1');
		expect(state.isCollapsed('casa-1')).toBe(false);
		expect(state.isCollapsed('fuera-1')).toBe(true);
		expect(JSON.parse(localStorage.getItem(PANTRY_COLLAPSED_STORAGE_KEY) ?? 'null')).toEqual([
			'fuera-1'
		]);

		state.toggle('fuera-1');
		expect(JSON.parse(localStorage.getItem(PANTRY_COLLAPSED_STORAGE_KEY) ?? 'null')).toEqual([]);
	});
});
