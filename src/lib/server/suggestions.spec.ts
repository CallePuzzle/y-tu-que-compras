import { describe, expect, it } from 'vitest';

// Test unitario (proyecto `server`, sin base de datos) de la RESOLUCIÓN de
// sugerencias de categoría por nombre (issue #173): es la parte pura — sin
// familia ni Prisma, las filas ya llegan filtradas — y decide TODO el
// contrato: qué nombres sugieren, cuál gana cuando un nombre se clasificó de
// varias maneras y qué hace el canónico con acentos y mayúsculas.
import { normalizeItemName } from '#lib/normalize-name.js';
import {
	resolveCategorySuggestions,
	resolveProductNameSuggestions,
	SOURCE_ITEM,
	SOURCE_PANTRY,
	SOURCE_RECIPE
} from './suggestions.js';
import type { ProductNameRow, SuggestionRow } from './suggestions.js';

/** Atajo para filas de prueba: los valores que no importan, puestos. */
function row(overrides: Partial<SuggestionRow>): SuggestionRow {
	return {
		name: 'Leche entera',
		categoryId: 'cat-1',
		source: SOURCE_ITEM,
		updatedAt: new Date('2026-01-01T10:00:00Z'),
		...overrides
	};
}

describe('resolveCategorySuggestions (#173)', () => {
	it('sugiere la categoría del nombre canónico: acentos y mayúsculas no cambian el nombre', () => {
		// El item guarda el nombre visible («Leche Entera»); quien teclea
		// «leche entera» o «LECHE ENTERA» en el alta debe recibir la misma
		// sugerencia: la clave del mapa es SIEMPRE el canónico.
		const suggestions = resolveCategorySuggestions([
			row({ name: 'Leche Entera', categoryId: 'cat-lacteos' })
		]);
		expect(suggestions).toEqual({ [normalizeItemName('Leche Entera')]: 'cat-lacteos' });
		expect(suggestions[normalizeItemName('LECHE  entera')]).toBe('cat-lacteos');
	});

	it('la despensa prefiere sobre los items de listas para el mismo nombre', () => {
		// El producto está asentado en la despensa (con su canónico guardado)
		// y además hay items con otra clasificación: manda la despensa.
		const suggestions = resolveCategorySuggestions([
			row({
				name: 'Leche entera',
				normalizedName: 'leche entera',
				categoryId: 'cat-despensa',
				source: SOURCE_PANTRY,
				updatedAt: new Date('2026-01-01T10:00:00Z')
			}),
			row({
				name: 'LECHE ENTERA',
				categoryId: 'cat-lacteos',
				source: SOURCE_ITEM,
				updatedAt: new Date('2026-06-01T10:00:00Z') // más reciente, pero item
			})
		]);
		expect(suggestions['leche entera']).toBe('cat-despensa');
	});

	it('a igual fuente, la clasificación más reciente gana', () => {
		// Dos items de la familia con el mismo nombre y categorías distintas:
		// la última vez que la familia clasificó ese nombre es la que sugiere.
		const suggestions = resolveCategorySuggestions([
			row({ name: 'leche entera', categoryId: 'cat-antigua', updatedAt: new Date('2026-01-01') }),
			row({ name: 'LECHE ENTERA', categoryId: 'cat-nueva', updatedAt: new Date('2026-03-01') })
		]);
		expect(suggestions['leche entera']).toBe('cat-nueva');
	});

	it('los nombres sin categoría no sugieren nada', () => {
		// El item conocido existe pero quedó sin categoría (la borraron, o
		// nunca se la pusieron): sin sugerencia para ese nombre… y si otra
		// fila del mismo nombre SÍ lleva categoría, esa entra.
		const suggestions = resolveCategorySuggestions([
			row({ name: 'Leche entera', categoryId: null }),
			row({ name: 'leche entera', categoryId: 'cat-lacteos' })
		]);
		expect(suggestions['leche entera']).toBe('cat-lacteos');
		expect(resolveCategorySuggestions([row({ categoryId: null })])).toEqual({});
	});

	it('nombres que el canónico deja vacíos no generan claves', () => {
		expect(resolveCategorySuggestions([row({ name: '   ', categoryId: 'cat-x' })])).toEqual({});
	});

	it('nombres distintos conviven en el mapa, cada uno con su categoría', () => {
		const suggestions = resolveCategorySuggestions([
			row({ name: 'Leche entera', categoryId: 'cat-lacteos' }),
			row({ name: 'Pan de molde', categoryId: 'cat-panaderia' }),
			row({ name: 'Lejía', categoryId: 'cat-limpieza' })
		]);
		expect(suggestions).toEqual({
			'leche entera': 'cat-lacteos',
			'pan de molde': 'cat-panaderia',
			lejia: 'cat-limpieza'
		});
	});
});

/** Atajo para filas de nombre: como `row`, más la unidad. */
function nameRow(overrides: Partial<ProductNameRow>): ProductNameRow {
	return {
		name: 'Patatas',
		unit: 'kilogram',
		categoryId: null,
		source: SOURCE_ITEM,
		updatedAt: new Date('2026-01-01T10:00:00Z'),
		...overrides
	};
}

describe('resolveProductNameSuggestions (#282)', () => {
	it('colapsa por canónico: «Patatas» y «patatas» son UNA sugerencia', () => {
		const suggestions = resolveProductNameSuggestions([
			nameRow({ name: 'Patatas', updatedAt: new Date('2026-01-01') }),
			nameRow({ name: 'patatas', updatedAt: new Date('2026-02-01') }),
			nameRow({ name: '  PATATAS ', source: SOURCE_RECIPE, updatedAt: new Date('2026-03-01') })
		]);
		// Gana el item más reciente (la receta es la fuente de menor prioridad).
		expect(suggestions).toEqual([
			{ name: 'patatas', unit: 'kilogram', categoryId: null, pantryItemId: null }
		]);
	});

	it('la despensa manda sobre listas y recetas, aunque sea más antigua', () => {
		const suggestions = resolveProductNameSuggestions([
			nameRow({
				name: 'Leche Entera',
				normalizedName: 'leche entera',
				unit: 'liter',
				pantryItemId: 'pantry-1',
				source: SOURCE_PANTRY,
				updatedAt: new Date('2026-01-01')
			}),
			nameRow({ name: 'leche entera', unit: 'unit', updatedAt: new Date('2026-06-01') }),
			nameRow({
				name: 'LECHE ENTERA',
				unit: 'milliliter',
				source: SOURCE_RECIPE,
				updatedAt: new Date('2026-07-01')
			})
		]);
		expect(suggestions).toEqual([
			{ name: 'Leche Entera', unit: 'liter', categoryId: null, pantryItemId: 'pantry-1' }
		]);
	});

	it('los items de listas mandan sobre los ingredientes de recetas', () => {
		const suggestions = resolveProductNameSuggestions([
			nameRow({
				name: 'Arroz',
				unit: 'gram',
				source: SOURCE_RECIPE,
				updatedAt: new Date('2026-09-01')
			}),
			nameRow({
				name: 'arroz',
				unit: 'package',
				source: SOURCE_ITEM,
				updatedAt: new Date('2026-01-01')
			})
		]);
		expect(suggestions).toEqual([
			{ name: 'arroz', unit: 'package', categoryId: null, pantryItemId: null }
		]);
	});

	it('a igual fuente gana la más reciente: varias unidades en despensa colapsan en una', () => {
		const suggestions = resolveProductNameSuggestions([
			nameRow({
				name: 'Tomate',
				normalizedName: 'tomate',
				unit: 'unit',
				pantryItemId: 'pantry-ud',
				source: SOURCE_PANTRY,
				updatedAt: new Date('2026-01-01')
			}),
			nameRow({
				name: 'Tomate',
				normalizedName: 'tomate',
				unit: 'kilogram',
				pantryItemId: 'pantry-kg',
				source: SOURCE_PANTRY,
				updatedAt: new Date('2026-04-01')
			})
		]);
		expect(suggestions).toEqual([
			{ name: 'Tomate', unit: 'kilogram', categoryId: null, pantryItemId: 'pantry-kg' }
		]);
	});

	it('la categoría sigue la regla de #173: solo cuentan las filas con categoría', () => {
		// La despensa gana el nombre pero no tiene categoría: la sugiere el item.
		const suggestions = resolveProductNameSuggestions([
			nameRow({
				name: 'Lejía',
				normalizedName: 'lejia',
				unit: 'liter',
				pantryItemId: 'pantry-1',
				source: SOURCE_PANTRY,
				categoryId: null
			}),
			nameRow({ name: 'lejia', unit: 'unit', categoryId: 'cat-limpieza' }),
			nameRow({ name: 'LEJÍA', source: SOURCE_RECIPE, categoryId: 'cat-receta' })
		]);
		expect(suggestions).toEqual([
			{ name: 'Lejía', unit: 'liter', categoryId: 'cat-limpieza', pantryItemId: 'pantry-1' }
		]);
	});

	it('nombres que el canónico deja vacíos no sugieren nada', () => {
		expect(resolveProductNameSuggestions([nameRow({ name: '   ' })])).toEqual([]);
		expect(resolveProductNameSuggestions([])).toEqual([]);
	});

	it('nombres distintos conviven, ordenados por nombre visible', () => {
		const suggestions = resolveProductNameSuggestions([
			nameRow({ name: 'Pan', unit: 'unit' }),
			nameRow({ name: 'aceite', unit: 'liter', source: SOURCE_RECIPE }),
			nameRow({ name: 'Leche', unit: 'liter' })
		]);
		expect(suggestions.map(({ name }) => name)).toEqual(['aceite', 'Leche', 'Pan']);
	});
});
