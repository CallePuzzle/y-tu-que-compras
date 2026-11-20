import { describe, expect, it } from 'vitest';

import { apiItemCreateSchema, apiItemPatchSchema, mentionsCategory } from './api-items.js';

// Schemas de los bodies de items de la API (tarea #268): mismo contrato que el
// formulario web (`itemSchema`) más la categoría por id o por nombre, y en el
// PATCH `purchased` y `order`.

describe('apiItemCreateSchema (#268)', () => {
	it('acepta el item del formulario web, con o sin categoría', () => {
		const schema = apiItemCreateSchema();
		expect(schema.parse({ name: ' Pan ', quantity: 1, unit: 'unit' })).toEqual({
			name: 'Pan',
			quantity: 1,
			unit: 'unit'
		});
		expect(
			schema.safeParse({ name: 'Pan', quantity: 1, unit: 'unit', category: 'Panadería' }).success
		).toBe(true);
		expect(
			schema.safeParse({ name: 'Pan', quantity: 1, unit: 'unit', categoryId: null }).success
		).toBe(true);
	});

	it('rechaza cantidad no positiva, unidad fuera del enum y nombre vacío', () => {
		const schema = apiItemCreateSchema();
		expect(schema.safeParse({ name: 'Pan', quantity: 0, unit: 'unit' }).success).toBe(false);
		expect(schema.safeParse({ name: 'Pan', quantity: 1, unit: 'barrel' }).success).toBe(false);
		expect(schema.safeParse({ name: ' ', quantity: 1, unit: 'unit' }).success).toBe(false);
		expect(schema.safeParse({ quantity: 1, unit: 'unit' }).success).toBe(false);
	});

	it('rechaza categoryId y category a la vez', () => {
		const result = apiItemCreateSchema().safeParse({
			name: 'Pan',
			quantity: 1,
			unit: 'unit',
			categoryId: 'a',
			category: 'b'
		});
		expect(result.success).toBe(false);
	});
});

describe('apiItemPatchSchema (#268)', () => {
	it('acepta cualquier campo suelto, incluidos purchased y order', () => {
		const schema = apiItemPatchSchema();
		expect(schema.parse({ purchased: true })).toEqual({ purchased: true });
		expect(schema.parse({ order: 0 })).toEqual({ order: 0 });
		expect(schema.parse({ categoryId: null })).toEqual({ categoryId: null });
	});

	it('rechaza el body vacío, order no entero o negativo y purchased no booleano', () => {
		const schema = apiItemPatchSchema();
		expect(schema.safeParse({}).success).toBe(false);
		expect(schema.safeParse({ order: 1.5 }).success).toBe(false);
		expect(schema.safeParse({ order: -1 }).success).toBe(false);
		expect(schema.safeParse({ purchased: 'true' }).success).toBe(false);
	});
});

describe('mentionsCategory (#268)', () => {
	it('distingue «no la toques» (ausente) de «quítala» (null)', () => {
		expect(mentionsCategory({})).toBe(false);
		expect(mentionsCategory({ categoryId: null })).toBe(true);
		expect(mentionsCategory({ category: 'Lácteos' })).toBe(true);
	});
});
