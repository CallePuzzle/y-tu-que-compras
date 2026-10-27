import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zod4 } from 'sveltekit-superforms/adapters';
import { superValidate } from 'sveltekit-superforms/server';
import { describe, expect, it } from 'vitest';
import { LIST_COLORS, LIST_ICONS, listSchema, type ListData } from './list.js';

/** Datos mínimos que el schema acepta, para mutar campo a campo en cada spec. */
const VALID = { name: 'Compra semanal', color: 'primary', icon: 'shopping-basket' } as const;

describe('listSchema', () => {
	it('acepta datos válidos y recorta el nombre', () => {
		const result = listSchema().safeParse({ ...VALID, name: '  Compra semanal  ' });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({
				name: 'Compra semanal',
				color: 'primary',
				icon: 'shopping-basket'
			});
		}
	});

	it('exige nombre: vacío o solo espacios no valida', () => {
		expect(listSchema().safeParse({ ...VALID, name: '' }).success).toBe(false);
		expect(listSchema().safeParse({ ...VALID, name: '   ' }).success).toBe(false);
	});

	it('limita el nombre a 100 caracteres, como la familia', () => {
		expect(listSchema().safeParse({ ...VALID, name: 'a'.repeat(100) }).success).toBe(true);
		expect(listSchema().safeParse({ ...VALID, name: 'a'.repeat(101) }).success).toBe(false);
	});

	it('está lista para superforms: los errores llegan al formulario', async () => {
		// Con el formulario vacío por defecto superforms no pinta errores (solo
		// marca `valid: false`); con datos inválidos sí los devuelve por campo.
		// El enum no tipa valores fuera de catálogo, así que el molde es explícito.
		const badData = {
			name: '',
			color: 'chartreuse',
			icon: 'shopping-basket'
		} as unknown as ListData;
		const invalid = await superValidate(
			badData,
			zod4(listSchema({ nameError: 'Pon nombre', colorError: 'Elige un color' }))
		);

		expect(invalid.valid).toBe(false);
		expect(invalid.errors.name).toEqual(['Pon nombre']);
		expect(invalid.errors.color).toEqual(['Elige un color']);

		const filled = await superValidate({ ...VALID }, zod4(listSchema()));

		expect(filled.valid).toBe(true);
		expect(filled.data).toEqual({ ...VALID });
	});

	it('rechaza colores fuera de la paleta daisyUI, con el mensaje inyectable', () => {
		const generic = listSchema().safeParse({ ...VALID, color: 'chartreuse' });
		const custom = listSchema({ colorError: 'Elige un color' }).safeParse({
			...VALID,
			color: 'chartreuse'
		});

		expect(generic.success).toBe(false);
		expect(custom.success).toBe(false);
		if (!generic.success && !custom.success) {
			// El texto que llega al formulario es el que inyecta el consumidor.
			expect(custom.error.issues[0]?.message).toBe('Elige un color');
		}
	});

	it('acepta cada color de la paleta', () => {
		for (const color of LIST_COLORS) {
			expect(listSchema().safeParse({ ...VALID, color }).success).toBe(true);
		}
	});

	it('rechaza iconos fuera del catálogo, aunque parezcan de lucide', () => {
		// «soap» existe en lucide pero no está en el catálogo de la UI: fuera.
		expect(listSchema().safeParse({ ...VALID, icon: 'soap' }).success).toBe(false);
		expect(listSchema().safeParse({ ...VALID, icon: 'no-existe' }).success).toBe(false);
	});

	it('acepta cada icono del catálogo', () => {
		for (const icon of LIST_ICONS) {
			expect(listSchema().safeParse({ ...VALID, icon }).success).toBe(true);
		}
	});
});

describe('LIST_COLORS', () => {
	it('son exactamente los ocho colores semánticos de daisyUI 5', () => {
		// Sin variantes `-content` ni `base-*`: no son colores de elección.
		expect([...LIST_COLORS].sort()).toEqual(
			['accent', 'error', 'info', 'neutral', 'primary', 'secondary', 'success', 'warning'].sort()
		);
	});
});

describe('LIST_ICONS', () => {
	it('todos los nombres son iconos reales del set lucide', () => {
		for (const icon of LIST_ICONS) {
			// Mismo nombre que la ruta de import `@lucide/svelte/icons/<icon>`:
			// si el fichero existe, el componente se puede renderizar.
			const file = fileURLToPath(
				new URL(`../../../node_modules/@lucide/svelte/dist/icons/${icon}.js`, import.meta.url)
			);
			expect(existsSync(file), `«${icon}» no existe en @lucide/svelte`).toBe(true);
		}
	});

	it('los nombres siguen el formato kebab-case de las rutas de lucide', () => {
		for (const icon of LIST_ICONS) {
			expect(icon).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		}
	});
});
