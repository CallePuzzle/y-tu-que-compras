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
const LIST = { name: 'Compra semanal', color: 'yellow', icon: 'shopping-basket' } as const;

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
		const listA = await createList(familyId, LIST);
		const listB = await createList(familyId, { ...LIST, name: 'Fereteria' });
		const dairy = await categoryRow(familyId, 'Lácteos');
		const cleaning = await categoryRow(familyId, 'Limpieza');
		const ferreteria = await categoryRow(familyId, 'Ferretería');

		// La despensa trae su canónico guardado (sin acentos)…
		await pantryRow({
			familyId,
			name: 'Leche Entera',
			normalizedName: 'leche entera',
			categoryId: dairy
		});
		// …y los items pueden estar en CUALQUIER lista de la familia: lo
		// escrito en la otra lista también es «conocido» (la «j» de «Lejía»
		// la normaliza la resolución sobre el nombre visible).
		await createItemOrFail(familyId, listA.id, {
			name: 'Lejía',
			quantity: 1,
			unit: 'liter',
			categoryId: cleaning
		});
		await createItemOrFail(familyId, listB.id, {
			name: 'Bomba de paren',
			quantity: 1,
			unit: 'unit',
			categoryId: ferreteria
		});

		expect(await listCategorySuggestions(familyId)).toEqual({
			'leche entera': dairy,
			lejia: cleaning,
			'bomba de paren': ferreteria
		});
	});

	it('solo sugieren los nombres con categoría; el resto del conocimiento se queda fuera', async () => {
		const familyId = await familyRow('Familia Sin Todo');
		const list = await createList(familyId, LIST);
		const dairy = await categoryRow(familyId, 'Lácteos');

		await pantryRow({ familyId, name: 'Leche', categoryId: dairy });
		// Conocidos pero SIN categoría: ni item ni producto de despensa entran.
		await pantryRow({ familyId, name: 'Sal' });
		await createItemOrFail(familyId, list.id, { name: 'Pan', quantity: 1, unit: 'unit' });

		expect(await listCategorySuggestions(familyId)).toEqual({ leche: dairy });
	});

	it('un nombre de OTRA familia no sugiere nada: el mapa es de la familia activa', async () => {
		const ownFamily = await familyRow('Familia Propia');
		const otherFamily = await familyRow('Familia Ajena');
		const ownList = await createList(ownFamily, LIST);
		const otherFamilyList = await createList(otherFamily, LIST);
		const ownCategory = await categoryRow(ownFamily, 'Lácteos');
		const otherFamilyCategory = await categoryRow(otherFamily, 'Lácteos');

		await pantryRow({
			familyId: otherFamily,
			name: 'Leche entera',
			categoryId: otherFamilyCategory
		});
		await createItem(otherFamily, otherFamilyList.id, {
			name: 'Yogur',
			quantity: 1,
			unit: 'unit',
			categoryId: otherFamilyCategory
		});
		await createItemOrFail(ownFamily, ownList.id, {
			name: 'Yogur',
			quantity: 1,
			unit: 'unit',
			categoryId: ownCategory
		});

		// El nombre ajeno («leche entera») no aparece; el propio («yogur»), sí.
		expect(await listCategorySuggestions(ownFamily)).toEqual({ yogur: ownCategory });
		expect(await listCategorySuggestions(otherFamily)).toEqual({
			'leche entera': otherFamilyCategory,
			yogur: otherFamilyCategory
		});
	});

	it('desempata como la resolución: despensa sobre items y, a igual fuente, recencia', async () => {
		const familyId = await familyRow('Familia Desempatante');
		const list = await createList(familyId, LIST);
		const dairy = await categoryRow(familyId, 'Lácteos');
		const cleaning = await categoryRow(familyId, 'Limpieza');

		// «Leche entera» está en la despensa (Lácteos) y en un item (Limpieza,
		// que además se creó después): manda la despensa, que es la fuente
		// asentada — la recencia solo desempata DENTRO de una fuente.
		await pantryRow({
			familyId,
			name: 'Leche entera',
			normalizedName: 'leche entera',
			categoryId: dairy
		});
		await createItemOrFail(familyId, list.id, {
			name: 'LECHE ENTERA',
			quantity: 1,
			unit: 'liter',
			categoryId: cleaning
		});

		// «Detergente» solo vive en items con dos clasificaciones: gana la más
		// reciente (fechas fijadas a mano, que dos `now()` seguidos podrían
		// caer en la misma milésima y entonces el orden sería el de escritura).
		const oldDetergent = await createItemOrFail(familyId, list.id, {
			name: 'Detergente',
			quantity: 1,
			unit: 'liter',
			categoryId: dairy
		});
		const newDetergent = await createItemOrFail(familyId, list.id, {
			name: 'Detergente',
			quantity: 2,
			unit: 'liter',
			categoryId: cleaning
		});
		await prisma.item.update({
			where: { id: oldDetergent.id },
			data: { updatedAt: new Date('2026-01-01T00:00:00Z') }
		});
		await prisma.item.update({
			where: { id: newDetergent.id },
			data: { updatedAt: new Date('2026-02-01T00:00:00Z') }
		});

		expect(await listCategorySuggestions(familyId)).toEqual({
			'leche entera': dairy,
			detergente: cleaning
		});
	});

	it('una familia sin nada conocido sugiere un mapa vacío', async () => {
		const familyId = await familyRow('Familia Novata');
		await createList(familyId, LIST);
		expect(await listCategorySuggestions(familyId)).toEqual({});
	});
});
