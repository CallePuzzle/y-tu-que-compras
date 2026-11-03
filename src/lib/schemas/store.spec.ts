import { zod4 } from 'sveltekit-superforms/adapters';
import { superValidate } from 'sveltekit-superforms/server';
import { describe, expect, it } from 'vitest';
import { storeSchema } from './store.js';

/** Datos mínimos que el schema acepta, para mutar campo a campo en cada spec. */
const VALID = { name: 'Mercadona' } as const;

describe('storeSchema', () => {
	it('acepta datos válidos y recorta el nombre', () => {
		const result = storeSchema().safeParse({ ...VALID, name: '  Mercadona  ' });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({ name: 'Mercadona' });
		}
	});

	it('exige nombre: vacío o solo espacios no valida', () => {
		expect(storeSchema().safeParse({ name: '' }).success).toBe(false);
		expect(storeSchema().safeParse({ name: '   ' }).success).toBe(false);
	});

	it('limita el nombre a 100 caracteres, como familia, lista y categoría', () => {
		expect(storeSchema().safeParse({ name: 'a'.repeat(100) }).success).toBe(true);
		expect(storeSchema().safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
	});

	it('está lista para superforms: los errores llegan al formulario', async () => {
		const invalid = await superValidate(
			{ name: '' },
			zod4(storeSchema({ nameError: 'Pon nombre' }))
		);

		expect(invalid.valid).toBe(false);
		expect(invalid.errors.name).toEqual(['Pon nombre']);

		const filled = await superValidate({ ...VALID }, zod4(storeSchema()));

		expect(filled.valid).toBe(true);
		expect(filled.data).toEqual({ ...VALID });
	});

	it('no valida duplicados: eso lo decide el único de la base sobre el nombre normalizado', () => {
		// «Mercadona» y «MERCADONA» pasan el formulario por separado: el choque
		// lo detecta el servidor (`StoreExistsError` vía P2002), que es quien
		// conoce el canónico (`normalizeItemName`).
		expect(storeSchema().safeParse({ name: 'Mercadona' }).success).toBe(true);
		expect(storeSchema().safeParse({ name: 'MERCADONA' }).success).toBe(true);
	});
});
