import { describe, expect, it } from 'vitest';
import { indexNameSuggestions, prefillField } from './name-suggestions.js';

describe('indexNameSuggestions', () => {
	it('indexa por nombre canónico', () => {
		const leche = { name: 'Leche Entera', unit: 'liter' as const, categoryId: 'c1' };
		const index = indexNameSuggestions([leche]);
		expect(index.get('leche entera')).toBe(leche);
		expect(index.get('Leche Entera')).toBeUndefined();
	});
});

describe('prefillField', () => {
	const options = { locked: false, fallback: 'unit' };

	it('aplica el valor sugerido a un campo libre', () => {
		expect(prefillField({ value: 'unit', suggested: false }, 'kilogram', options)).toEqual({
			value: 'kilogram',
			suggested: true
		});
	});

	it('sustituye una sugerencia anterior', () => {
		expect(prefillField({ value: 'kilogram', suggested: true }, 'liter', options)).toEqual({
			value: 'liter',
			suggested: true
		});
	});

	it('nunca pisa un campo bloqueado por una elección manual', () => {
		const field = { value: 'can', suggested: false };
		expect(prefillField(field, 'kilogram', { ...options, locked: true })).toBe(field);
	});

	it('sin sugerencia retira lo sugerido y vuelve al fallback', () => {
		expect(prefillField({ value: 'kilogram', suggested: true }, undefined, options)).toEqual({
			value: 'unit',
			suggested: false
		});
		expect(
			prefillField({ value: 'c1', suggested: true }, null, { locked: false, fallback: '' })
		).toEqual({ value: '', suggested: false });
	});

	it('sin sugerencia deja intacto lo que no puso ella', () => {
		const field = { value: 'can', suggested: false };
		expect(prefillField(field, undefined, options)).toBe(field);
	});
});
