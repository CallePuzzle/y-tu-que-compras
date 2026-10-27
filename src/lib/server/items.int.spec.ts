import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): las funciones de
// `$lib/server/items.ts` contra un Postgres real con las migraciones
// aplicadas. Como en `lists.int.spec.ts` no hacen falta sesiones: las
// familias y sus listas de prueba se crean directamente con Prisma y lo que
// se ejercita es el CRUD de items con el filtro de familia activa — el
// criterio de la issue #68: cada familia ve solo lo suyo, y los ids ajenos
// (de otra familia o de otra lista) no se pueden tocar ni por error.
import type { ItemData } from '$lib/schemas/item.js';
import prisma from './prisma.js';
import { createItem, deleteItem, listItems, updateItem } from './items.js';
import { createList } from './lists.js';

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

/** Datos válidos según `itemSchema`, para mutar campo a campo en cada spec. */
const ITEM: ItemData = { name: 'Leche entera', quantity: 2, unit: 'liter' };

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

describe('CRUD de items por familia y lista (#68)', () => {
	it('createItem guarda nombre, cantidad y unidad, y calcula el orden en el servidor', async () => {
		const familyId = await familyRow('Familia Compradora');
		const list = await createList(familyId, LISTA);

		const first = await createItemOrFail(familyId, list.id, ITEM);
		expect(first).toMatchObject({ name: ITEM.name, quantity: 2, unit: 'liter' });

		const row = await prisma.item.findUniqueOrThrow({ where: { id: first.id } });
		expect(row.listId).toBe(list.id);
		// El `order` lo calcula el SERVIDOR (el schema no trae default): el
		// primer item de una lista nueva empieza por 0 y cada alta va después.
		expect(row.order).toBe(0);

		const second = await createItemOrFail(familyId, list.id, {
			...ITEM,
			name: 'Pan',
			unit: 'unit'
		});
		const secondRow = await prisma.item.findUniqueOrThrow({ where: { id: second.id } });
		expect(secondRow.order).toBe(1);
	});

	it('createItem respeta los decimales de la cantidad', async () => {
		const familyId = await familyRow('Familia Exacta');
		const list = await createList(familyId, LISTA);

		const created = await createItemOrFail(familyId, list.id, {
			...ITEM,
			name: 'Queso',
			quantity: 0.5,
			unit: 'kilogram'
		});
		expect(created.quantity).toBe(0.5);
	});

	it('createItem devuelve null para una lista ajena a la familia y no crea nada', async () => {
		const mia = await familyRow('Familia Propia');
		const ajena = await familyRow('Familia Ajena');
		const externa = await createList(ajena, LISTA);

		expect(await createItem(mia, externa.id, ITEM)).toBeNull();
		expect(await prisma.item.findMany({ where: { listId: externa.id } })).toHaveLength(0);
	});

	it('listItems devuelve los items de la lista en su orden, y solo los de la familia', async () => {
		const mia = await familyRow('Familia Listera');
		const ajena = await familyRow('Familia Ajena');
		const propia = await createList(mia, LISTA);
		const externa = await createList(ajena, LISTA);

		await createItemOrFail(mia, propia.id, { ...ITEM, name: 'Pan', unit: 'unit' });
		await createItemOrFail(mia, propia.id, { ...ITEM, name: 'Leche' });
		await createItemOrFail(ajena, externa.id, { ...ITEM, name: 'Secreto' });

		const items = await listItems(mia, propia.id);
		expect(items.map((item) => item.name)).toEqual(['Pan', 'Leche']);
		// El Decimal de la base se lee como number para la vista.
		expect(items[1].quantity).toBe(2);
	});

	it('listItems devuelve vacío para una lista que no es de la familia', async () => {
		const mia = await familyRow('Familia Sola');
		const ajena = await familyRow('Familia Ajena');
		const externa = await createList(ajena, LISTA);
		await createItem(ajena, externa.id, ITEM);

		expect(await listItems(mia, externa.id)).toEqual([]);
	});

	it('updateItem cambia un item propio; uno ajeno devuelve false y no se toca', async () => {
		const mia = await familyRow('Familia Editora');
		const ajena = await familyRow('Familia Intacta');
		const propia = await createList(mia, LISTA);
		const externa = await createList(ajena, LISTA);
		const propio = await createItemOrFail(mia, propia.id, ITEM);
		const ajeno = await createItemOrFail(ajena, externa.id, ITEM);

		const changed = await updateItem(mia, propia.id, propio.id, {
			name: 'Leche desnatada',
			quantity: 6,
			unit: 'unit'
		});
		expect(changed).toBe(true);
		expect(await prisma.item.findUniqueOrThrow({ where: { id: propio.id } })).toMatchObject({
			name: 'Leche desnatada',
			unit: 'unit'
		});

		// El id de un item de OTRA familia no se puede actualizar aunque se
		// conozca: el filtro de familia activa lo hace inalcanzable.
		const foreign = await updateItem(mia, propia.id, ajeno.id, { ...ITEM, name: 'Vándalo' });
		expect(foreign).toBe(false);
		expect((await prisma.item.findUniqueOrThrow({ where: { id: ajeno.id } })).name).toBe(ITEM.name);

		// Igual con un id inexistente.
		expect(await updateItem(mia, propia.id, randomUUID(), ITEM)).toBe(false);
	});

	it('updateItem devuelve false para un item de otra lista de la misma familia', async () => {
		const mia = await familyRow('Familia de Dos Listas');
		const mercado = await createList(mia, LISTA);
		const parafarmacia = await createList(mia, { ...LISTA, name: 'Parafarmacia' });
		const ajeno = await createItemOrFail(mia, parafarmacia.id, ITEM);

		// Mismo id de familia pero la lista del `where` no es la suya: el item
		// no está ahí y no se toca (el filtro de lista acota el alcance).
		expect(await updateItem(mia, mercado.id, ajeno.id, ITEM)).toBe(false);
	});

	it('deleteItem borra solo de su lista; uno ajeno devuelve false y queda', async () => {
		const mia = await familyRow('Familia Borradora');
		const ajena = await familyRow('Familia Superviviente');
		const propia = await createList(mia, LISTA);
		const externa = await createList(ajena, LISTA);
		const propio = await createItemOrFail(mia, propia.id, ITEM);
		const ajeno = await createItemOrFail(ajena, externa.id, ITEM);

		expect(await deleteItem(mia, propia.id, ajeno.id)).toBe(false);
		expect(await prisma.item.findUnique({ where: { id: ajeno.id } })).not.toBeNull();

		expect(await deleteItem(mia, propia.id, propio.id)).toBe(true);
		expect(await prisma.item.findUnique({ where: { id: propio.id } })).toBeNull();
	});

	it('borrar la lista se lleva sus items (FK en cascada)', async () => {
		const familyId = await familyRow('Familia Evanescente');
		const list = await createList(familyId, LISTA);
		const a = await createItemOrFail(familyId, list.id, ITEM);
		const b = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Pan', unit: 'unit' });

		await prisma.list.delete({ where: { id: list.id } });

		expect(await prisma.item.findMany({ where: { id: { in: [a.id, b.id] } } })).toHaveLength(0);
	});
});
