import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): `listProductNameSuggestions`
// contra un Postgres real con las migraciones aplicadas (issues #173 y #282).
// Como en `items.int.spec.ts` no hacen falta sesiones: la despensa, los items
// y las recetas de prueba se crean directamente con Prisma y lo que se
// ejercita es la consulta que alimenta las sugerencias — despensa + items de
// TODAS las listas + ingredientes de recetas de la familia, y nada de
// familias ajenas. El desempate fino (fuente y recencia) está unitariamente
// en `suggestions.spec.ts`; aquí se comprueba que la consulta le pasa a la
// resolución las filas correctas.
import prisma from './prisma.js';
import type { ItemData, Unit } from '#lib/schemas/item.js';
import { createItem } from './items.js';
import { createList } from './lists.js';
import { listProductNameSuggestions } from './suggestions.js';

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
	unit?: Unit;
}): Promise<string> {
	const { id } = await prisma.pantryItem.create({
		data: {
			organizationId: options.familyId,
			name: options.name,
			normalizedName: options.normalizedName ?? options.name.trim().toLowerCase(),
			quantity: 1,
			unit: options.unit ?? 'unit',
			categoryId: options.categoryId ?? null
		}
	});
	return id;
}

/** Una receta con sus ingredientes directamente en la base (sin enlazar despensa). */
async function recipeRow(
	familyId: string,
	name: string,
	ingredients: { name: string; unit: Unit; categoryId?: string | null }[]
): Promise<void> {
	await prisma.recipe.create({
		data: {
			organizationId: familyId,
			name,
			normalizedName: name.trim().toLowerCase(),
			ingredients: {
				create: ingredients.map((ingredient, position) => ({
					position,
					name: ingredient.name,
					quantity: 1,
					unit: ingredient.unit,
					categoryId: ingredient.categoryId ?? null
				}))
			}
		}
	});
}

describe('listProductNameSuggestions (#282)', () => {
	it('agrega despensa, items de todas las listas e ingredientes de recetas, por canónico', async () => {
		const familyId = await familyRow('Familia Autocompletada');
		const listA = await createList(familyId, LIST);
		const listB = await createList(familyId, { ...LIST, name: 'Otra lista' });
		const dairy = await categoryRow(familyId, 'Lácteos');
		const veggies = await categoryRow(familyId, 'Verduras');

		const milkId = await pantryRow({
			familyId,
			name: 'Leche Entera',
			normalizedName: 'leche entera',
			unit: 'liter'
		});
		// El mismo canónico en un item (con categoría) y en una receta: una
		// sola sugerencia, con nombre/unidad/enlace de la despensa y la
		// categoría del item (la despensa no la tiene).
		await createItemOrFail(familyId, listA.id, {
			name: 'LECHE ENTERA',
			quantity: 1,
			unit: 'unit',
			categoryId: dairy
		});
		await createItemOrFail(familyId, listB.id, { name: 'Patatas', quantity: 2, unit: 'kilogram' });
		await recipeRow(familyId, 'Tortilla', [
			{ name: 'patatas', unit: 'gram', categoryId: veggies },
			{ name: 'Leche entera', unit: 'milliliter' },
			{ name: 'Huevos', unit: 'dozen' }
		]);

		expect(await listProductNameSuggestions(familyId)).toEqual([
			{ name: 'Huevos', unit: 'dozen', categoryId: null, pantryItemId: null },
			{ name: 'Leche Entera', unit: 'liter', categoryId: dairy, pantryItemId: milkId },
			// «Patatas» (item) manda sobre «patatas» (receta): UNA sugerencia.
			{ name: 'Patatas', unit: 'kilogram', categoryId: veggies, pantryItemId: null }
		]);
	});

	it('una familia solo ve sus propios nombres', async () => {
		const ownFamily = await familyRow('Familia Propia Nombres');
		const otherFamily = await familyRow('Familia Ajena Nombres');
		const ownList = await createList(ownFamily, LIST);
		const otherList = await createList(otherFamily, LIST);

		await pantryRow({ familyId: otherFamily, name: 'Sal' });
		await createItemOrFail(otherFamily, otherList.id, { name: 'Pan', quantity: 1, unit: 'unit' });
		await recipeRow(otherFamily, 'Gazpacho', [{ name: 'Pepino', unit: 'unit' }]);
		await createItemOrFail(ownFamily, ownList.id, { name: 'Yogur', quantity: 1, unit: 'unit' });

		expect(await listProductNameSuggestions(ownFamily)).toEqual([
			{ name: 'Yogur', unit: 'unit', categoryId: null, pantryItemId: null }
		]);
		expect((await listProductNameSuggestions(otherFamily)).map(({ name }) => name)).toEqual([
			'Pan',
			'Pepino',
			'Sal'
		]);
	});

	it('la categoría desempata como en #173: despensa sobre items y, a igual fuente, recencia', async () => {
		const familyId = await familyRow('Familia Desempatante');
		const list = await createList(familyId, LIST);
		const dairy = await categoryRow(familyId, 'Lácteos');
		const cleaning = await categoryRow(familyId, 'Limpieza');

		// «Leche entera» está en la despensa (Lácteos) y en un item (Limpieza,
		// creado después): manda la despensa, que es la fuente asentada — la
		// recencia solo desempata DENTRO de una fuente.
		const milkId = await pantryRow({
			familyId,
			name: 'Leche entera',
			normalizedName: 'leche entera',
			unit: 'liter',
			categoryId: dairy
		});
		await createItemOrFail(familyId, list.id, {
			name: 'LECHE ENTERA',
			quantity: 1,
			unit: 'liter',
			categoryId: cleaning
		});

		// «Detergente» solo vive en items con dos clasificaciones: gana la más
		// reciente (fechas fijadas a mano: dos `now()` seguidos podrían caer
		// en la misma milésima).
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

		expect(await listProductNameSuggestions(familyId)).toEqual([
			{ name: 'Detergente', unit: 'liter', categoryId: cleaning, pantryItemId: null },
			{ name: 'Leche entera', unit: 'liter', categoryId: dairy, pantryItemId: milkId }
		]);
	});

	it('una familia sin nada conocido no sugiere nada', async () => {
		const familyId = await familyRow('Familia Novata Nombres');
		expect(await listProductNameSuggestions(familyId)).toEqual([]);
	});
});
