import { describe, expect, it } from 'vitest';
import {
	indexNameSuggestions,
	ingredientPrefillState,
	mealIngredientPrefillState,
	prefillField,
	prefillIngredient,
	prefillMealIngredient
} from './name-suggestions.js';

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

describe('prefillIngredient', () => {
	const index = indexNameSuggestions([
		{ name: 'Leche entera', unit: 'liter' as const, categoryId: null, pantryItemId: 'p1' },
		{ name: 'Patatas', unit: 'kilogram' as const, categoryId: null, pantryItemId: null }
	]);
	const fresh = ingredientPrefillState({ name: '', unit: 'unit', pantryItemId: '' });

	it('casa por canónico: hereda la unidad y enlaza la despensa', () => {
		const result = prefillIngredient({ name: 'LECHE  Entera', unit: 'unit' }, fresh, index);
		expect(result.unit).toBe('liter');
		expect(result.pantryItemId).toBe('p1');
		expect(result.state.unitSuggested).toBe(true);
	});

	it('un nombre que no es de despensa hereda la unidad pero queda suelto', () => {
		const result = prefillIngredient({ name: 'patatas', unit: 'unit' }, fresh, index);
		expect(result.unit).toBe('kilogram');
		expect(result.pantryItemId).toBe('');
	});

	it('la unidad elegida a mano no se pisa, pero el enlace sí se calcula', () => {
		const manual = { ...fresh, unitManual: true };
		const result = prefillIngredient({ name: 'Leche entera', unit: 'milliliter' }, manual, index);
		expect(result.unit).toBe('milliliter');
		expect(result.pantryItemId).toBe('p1');
	});

	it('dejar de casar retira la unidad sugerida y el enlace', () => {
		const suggested = { ...fresh, unitSuggested: true };
		const result = prefillIngredient({ name: 'Leche de avena', unit: 'liter' }, suggested, index);
		expect(result.unit).toBe('unit');
		expect(result.pantryItemId).toBe('');
		expect(result.state.unitSuggested).toBe(false);
	});

	it('volver al nombre con el que se abrió la fila restaura su unidad y su enlace', () => {
		const base = ingredientPrefillState({ name: 'Patatas', unit: 'gram', pantryItemId: 'old' });
		const away = prefillIngredient({ name: 'Leche entera', unit: 'gram' }, base, index);
		expect(away).toMatchObject({ unit: 'liter', pantryItemId: 'p1' });
		const back = prefillIngredient({ name: 'patatas', unit: away.unit }, away.state, index);
		expect(back).toMatchObject({ unit: 'gram', pantryItemId: 'old' });
	});
});

describe('prefillMealIngredient', () => {
	const index = indexNameSuggestions([
		{ name: 'Leche entera', unit: 'liter' as const, categoryId: 'dairy', pantryItemId: 'p1' },
		{ name: 'Patatas', unit: 'kilogram' as const, categoryId: null, pantryItemId: null }
	]);
	const fresh = mealIngredientPrefillState({ name: '', unit: 'unit', categoryId: '' });

	it('casa por canónico: hereda unidad y categoría', () => {
		const result = prefillMealIngredient(
			{ name: 'leche ENTERA', unit: 'unit', categoryId: '' },
			fresh,
			index
		);
		expect(result).toMatchObject({ unit: 'liter', categoryId: 'dairy' });
		expect(result.state).toMatchObject({ unitSuggested: true, categorySuggested: true });
	});

	it('lo elegido a mano no se pisa', () => {
		const manual = { ...fresh, unitManual: true, categoryManual: true };
		const result = prefillMealIngredient(
			{ name: 'Leche entera', unit: 'milliliter', categoryId: 'other' },
			manual,
			index
		);
		expect(result).toMatchObject({ unit: 'milliliter', categoryId: 'other' });
	});

	it('una sugerencia sin categoría retira la sugerida antes', () => {
		const away = prefillMealIngredient(
			{ name: 'Leche entera', unit: 'unit', categoryId: '' },
			fresh,
			index
		);
		const result = prefillMealIngredient(
			{ name: 'Patatas', unit: away.unit, categoryId: away.categoryId },
			away.state,
			index
		);
		expect(result).toMatchObject({ unit: 'kilogram', categoryId: '' });
		expect(result.state.categorySuggested).toBe(false);
	});

	it('volver al nombre de la base restaura su unidad y su categoría', () => {
		const base = mealIngredientPrefillState({ name: 'Huevos', unit: 'unit', categoryId: 'eggs' });
		const away = prefillMealIngredient(
			{ name: 'Leche entera', unit: 'unit', categoryId: 'eggs' },
			base,
			index
		);
		expect(away).toMatchObject({ unit: 'liter', categoryId: 'dairy' });
		const back = prefillMealIngredient(
			{ name: 'huevos', unit: away.unit, categoryId: away.categoryId },
			away.state,
			index
		);
		expect(back).toMatchObject({ unit: 'unit', categoryId: 'eggs' });
	});
});
