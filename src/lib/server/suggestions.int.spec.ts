import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): `listCategorySuggestions`
// contra un Postgres real con las migraciones aplicadas (issue #173). Como en
// `items.int.spec.ts` no hacen falta sesiones: la despensa y los items de
// prueba se crean directamente con Prisma y lo que se ejercita es la consulta
// que alimenta el mapa de sugerencias — despensa + items de TODAS las listas
// de la familia, y nada de familias ajenas. El desempate fino (fuente y
// recencia) está unitariamente en `suggestions.spec.ts`; aquí se comprueba
// que la consulta le pasa a la resolución las filas correctas.
import prisma from './prisma.js';
import type { ItemData } from '#lib/schemas/item.js';
import { createItem } from './items.js';
import { createList } from './lists.js';
import { listCategorySuggestions } from './suggestions.js';

/** Crea una familia directamente en la base y devuelve su id. */
async function familyRow(prefix: string): Promise<string> {
	const id = randomUUID();
	await prisma.organization.create({
		data: {
			id,
			name: `${prefix} ${id.slice(0, 8)}`,
			// El formato de `slug` lo exige el plugin (^[a-z0-9-]+$, máx 50); aquí
			// solo hace falta cumplirlo para la FK.
			slug: `familia-${id.slice(0, 13).toLowerCase()}`
		}
	});
	return id;
}

/** Datos válidos según `listSchema`, para crear las listas de prueba. */
const LISTA = { name: 'Compra semanal', color: 'primary', icon: 'shopping-basket' } as const;

/**
 * Crea un item para montar el escenario y falla el test si no se creó (el
 * `null` de lista ajena lo ejercita su propio spec, aquí es ruido).
 */
async function createItemOrFail(familyId: string, listId: string, data: ItemData) {
	const created = await createItem(familyId, listId, data);
	if (!created) {
		throw new Error('El item no se creó: la lista no pertenece a la familia');
	}
	return created;
}

/** Una categoría de la familia (el alta por UI no hace falta para el mapa). */
async function categoryRow(familyId: string, name: string): Promise<string> {
	const id = randomUUID();
	await prisma.category.create({
		data: {
			id,
			organizationId: familyId,
			name,
			// El canónico, igual que lo escribe `createCategory` (NFD, sin
			// acentos, minúsculas, espacios colapsados).
			normalizedName: name
				.trim()
				.normalize('NFD')
				.replace(/\p{Diacritic}/gu, '')
				.toLowerCase()
				.replace(/\s+/g, ' '),
			position: 0
		}
	});
	return id;
}

/** Un producto de la despensa directamente en la base, como lo deja `finalizePurchase`. */
async function pantryRow(options: {
	familyId: string;
	name: string;
	normalizedName?: string;
	categoryId?: string | null;
}): Promise<void> {
	await prisma.pantryItem.create({
		data: {
			organizationId: options.familyId,
			name: options.name,
			normalizedName: options.normalizedName ?? options.name.trim().toLowerCase(),
			quantity: 1,
			unit: 'unit',
			categoryId: options.categoryId ?? null
		}
	});
}

describe('listCategorySuggestions (#173)', () => {
	it('mezcla despensa e items de todas las listas de la familia, por nombre canónico', async () => {
		const familyId = await familyRow('Familia Sugiriente');
		const listaA = await createList(familyId, LISTA);
		const listaB = await createList(familyId, { ...LISTA, name: 'Fereteria' });
		const lacteos = await categoryRow(familyId, 'Lácteos');
		const limpieza = await categoryRow(familyId, 'Limpieza');
		const ferreteria = await categoryRow(familyId, 'Ferretería');

		// La despensa trae su canónico guardado (sin acentos)…
		await pantryRow({
			familyId,
			name: 'Leche Entera',
			normalizedName: 'leche entera',
			categoryId: lacteos
		});
		// …y los items pueden estar en CUALQUIER lista de la familia: lo
		// escrito en la otra lista también es «conocido» (la «j» de «Lejía»
		// la normaliza la resolución sobre el nombre visible).
		await createItemOrFail(familyId, listaA.id, {
			name: 'Lejía',
			quantity: 1,
			unit: 'liter',
			categoryId: limpieza
		});
		await createItemOrFail(familyId, listaB.id, {
			name: 'Bomba de paren',
			quantity: 1,
			unit: 'unit',
			categoryId: ferreteria
		});

		expect(await listCategorySuggestions(familyId)).toEqual({
			'leche entera': lacteos,
			lejia: limpieza,
			'bomba de paren': ferreteria
		});
	});

	it('solo sugieren los nombres con categoría; el resto del conocimiento se queda fuera', async () => {
		const familyId = await familyRow('Familia Sin Todo');
		const lista = await createList(familyId, LISTA);
		const lacteos = await categoryRow(familyId, 'Lácteos');

		await pantryRow({ familyId, name: 'Leche', categoryId: lacteos });
		// Conocidos pero SIN categoría: ni item ni producto de despensa entran.
		await pantryRow({ familyId, name: 'Sal' });
		await createItemOrFail(familyId, lista.id, { name: 'Pan', quantity: 1, unit: 'unit' });

		expect(await listCategorySuggestions(familyId)).toEqual({ leche: lacteos });
	});

	it('un nombre de OTRA familia no sugiere nada: el mapa es de la familia activa', async () => {
		const mia = await familyRow('Familia Propia');
		const ajena = await familyRow('Familia Ajena');
		const miaLista = await createList(mia, LISTA);
		const ajenaLista = await createList(ajena, LISTA);
		const miaCategoria = await categoryRow(mia, 'Lácteos');
		const ajenaCategoria = await categoryRow(ajena, 'Lácteos');

		await pantryRow({ familyId: ajena, name: 'Leche entera', categoryId: ajenaCategoria });
		await createItem(ajena, ajenaLista.id, {
			name: 'Yogur',
			quantity: 1,
			unit: 'unit',
			categoryId: ajenaCategoria
		});
		await createItemOrFail(mia, miaLista.id, {
			name: 'Yogur',
			quantity: 1,
			unit: 'unit',
			categoryId: miaCategoria
		});

		// El nombre ajeno («leche entera») no aparece; el propio («yogur»), sí.
		expect(await listCategorySuggestions(mia)).toEqual({ yogur: miaCategoria });
		expect(await listCategorySuggestions(ajena)).toEqual({
			'leche entera': ajenaCategoria,
			yogur: ajenaCategoria
		});
	});

	it('desempata como la resolución: despensa sobre items y, a igual fuente, recencia', async () => {
		const familyId = await familyRow('Familia Desempatante');
		const lista = await createList(familyId, LISTA);
		const lacteos = await categoryRow(familyId, 'Lácteos');
		const limpieza = await categoryRow(familyId, 'Limpieza');

		// «Leche entera» está en la despensa (Lácteos) y en un item (Limpieza,
		// que además se creó después): manda la despensa, que es la fuente
		// asentada — la recencia solo desempata DENTRO de una fuente.
		await pantryRow({
			familyId,
			name: 'Leche entera',
			normalizedName: 'leche entera',
			categoryId: lacteos
		});
		await createItemOrFail(familyId, lista.id, {
			name: 'LECHE ENTERA',
			quantity: 1,
			unit: 'liter',
			categoryId: limpieza
		});

		// «Detergente» solo vive en items con dos clasificaciones: gana la más
		// reciente (fechas fijadas a mano, que dos `now()` seguidos podrían
		// caer en la misma milésima y entonces el orden sería el de escritura).
		const detViejo = await createItemOrFail(familyId, lista.id, {
			name: 'Detergente',
			quantity: 1,
			unit: 'liter',
			categoryId: lacteos
		});
		const detNuevo = await createItemOrFail(familyId, lista.id, {
			name: 'Detergente',
			quantity: 2,
			unit: 'liter',
			categoryId: limpieza
		});
		await prisma.item.update({
			where: { id: detViejo.id },
			data: { updatedAt: new Date('2026-01-01T00:00:00Z') }
		});
		await prisma.item.update({
			where: { id: detNuevo.id },
			data: { updatedAt: new Date('2026-02-01T00:00:00Z') }
		});

		expect(await listCategorySuggestions(familyId)).toEqual({
			'leche entera': lacteos,
			detergente: limpieza
		});
	});

	it('una familia sin nada conocido sugiere un mapa vacío', async () => {
		const familyId = await familyRow('Familia Novata');
		await createList(familyId, LISTA);
		expect(await listCategorySuggestions(familyId)).toEqual({});
	});
});
