import { zod4 } from 'sveltekit-superforms/adapters';
import { superValidate } from 'sveltekit-superforms/server';
import { describe, expect, it } from 'vitest';
import { categorySchema } from './category.js';

/** Datos mínimos que el schema acepta, para mutar campo a campo en cada spec. */
const VALID = { name: 'Lácteos' } as const;

describe('categorySchema', () => {
	it('acepta datos válidos y recorta el nombre', () => {
		const result = categorySchema().safeParse({ ...VALID, name: '  Lácteos  ' });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({ name: 'Lácteos' });
		}
	});

	it('exige nombre: vacío o solo espacios no valida', () => {
		expect(categorySchema().safeParse({ name: '' }).success).toBe(false);
		expect(categorySchema().safeParse({ name: '   ' }).success).toBe(false);
	});

	it('limita el nombre a 100 caracteres, como familia y lista', () => {
		expect(categorySchema().safeParse({ name: 'a'.repeat(100) }).success).toBe(true);
		expect(categorySchema().safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
	});

	it('está lista para superforms: los errores llegan al formulario', async () => {
		const invalid = await superValidate(
			{ name: '' },
			zod4(categorySchema({ nameError: 'Pon nombre' }))
		);

		expect(invalid.valid).toBe(false);
		expect(invalid.errors.name).toEqual(['Pon nombre']);

		const filled = await superValidate({ ...VALID }, zod4(categorySchema()));

		expect(filled.valid).toBe(true);
		expect(filled.data).toEqual({ ...VALID });
	});

	it('no valida duplicados: eso lo decide el único de la base sobre el nombre normalizado', () => {
		// «Lácteos» y «LACTEOS» pasan el formulario por separado: el choque lo
		// detecta el servidor (`CategoryExistsError` vía P2002), que es quien
		// conoce el canónico (`normalizeItemName`).
		expect(categorySchema().safeParse({ name: 'Lácteos' }).success).toBe(true);
		expect(categorySchema().safeParse({ name: 'LACTEOS' }).success).toBe(true);
	});
});
