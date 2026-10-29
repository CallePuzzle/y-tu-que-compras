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
import {
	createItem,
	deleteItem,
	listItems,
	reorderItems,
	setItemPurchased,
	updateItem
} from './items.js';
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

describe('Marcar item como comprado (#69)', () => {
	it('setItemPurchased marca y desmarca un item propio, y persiste', async () => {
		const familyId = await familyRow('Familia Compradora');
		const list = await createList(familyId, LISTA);
		const item = await createItemOrFail(familyId, list.id, ITEM);

		expect(await setItemPurchased(familyId, list.id, item.id, true)).toBe(true);
		expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).purchased).toBe(true);

		// Desmarcar también persiste: el criterio de aceptación lo cubre entero
		// («marco y desmarco items y el estado persiste entre recargas»).
		expect(await setItemPurchased(familyId, list.id, item.id, false)).toBe(true);
		expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).purchased).toBe(false);
	});

	it('setItemPurchased no toca items ajenos: otra familia, otra lista o id inexistente', async () => {
		const mia = await familyRow('Familia Compradora');
		const ajena = await familyRow('Familia Intacta');
		const propia = await createList(mia, LISTA);
		const externa = await createList(ajena, LISTA);
		const ajeno = await createItemOrFail(ajena, externa.id, ITEM);
		const parafarmacia = await createList(mia, { ...LISTA, name: 'Parafarmacia' });
		const deOtraLista = await createItemOrFail(mia, parafarmacia.id, ITEM);

		// El id de un item de OTRA familia no se puede marcar aunque se conozca.
		expect(await setItemPurchased(mia, propia.id, ajeno.id, true)).toBe(false);
		expect((await prisma.item.findUniqueOrThrow({ where: { id: ajeno.id } })).purchased).toBe(
			false
		);

		// El filtro de lista acota también dentro de la misma familia.
		expect(await setItemPurchased(mia, propia.id, deOtraLista.id, true)).toBe(false);
		expect((await prisma.item.findUniqueOrThrow({ where: { id: deOtraLista.id } })).purchased).toBe(
			false
		);

		expect(await setItemPurchased(mia, propia.id, randomUUID(), true)).toBe(false);
	});

	it('listItems trae el comprado y ordena pendientes antes que comprados', async () => {
		const familyId = await familyRow('Familia con Carrito');
		const list = await createList(familyId, LISTA);
		const a = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Pan', unit: 'unit' });
		const b = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Leche' });
		const c = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Huevos', unit: 'dozen' });

		await setItemPurchased(familyId, list.id, b.id, true);

		// El orden visual agrupa: primero los pendientes en su `order`, luego
		// los comprados — la separación de la issue, también sin JS.
		const items = await listItems(familyId, list.id);
		expect(items.map((item) => item.id)).toEqual([a.id, c.id, b.id]);
		expect(items.map((item) => item.purchased)).toEqual([false, false, true]);
	});
});

/** El orden guardado de los items de una lista, por id. */
async function ordenDe(listId: string): Promise<string[]> {
	const filas = await prisma.item.findMany({
		where: { listId },
		orderBy: { order: 'asc' },
		select: { id: true }
	});
	return filas.map((fila) => fila.id);
}

describe('Reordenar los pendientes (#134)', () => {
	it('renumera 1..n el orden nuevo del swap y persiste', async () => {
		const familyId = await familyRow('Familia Reordenadora');
		const list = await createList(familyId, LISTA);
		const a = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Pan', unit: 'unit' });
		const b = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Leche' });
		const c = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Huevos', unit: 'dozen' });

		// El swap de la vista: C, A, B.
		await expect(reorderItems(familyId, list.id, [c.id, a.id, b.id])).resolves.toBe(true);

		await expect(ordenDe(list.id)).resolves.toEqual([c.id, a.id, b.id]);
		// La renumeración es densa 1..n, y `listItems` la sirve tal cual.
		const filas = await prisma.item.findMany({ where: { listId: list.id } });
		expect(filas.map((fila) => fila.order).sort((x, y) => x - y)).toEqual([1, 2, 3]);
		const items = await listItems(familyId, list.id);
		expect(items.map((item) => item.id)).toEqual([c.id, a.id, b.id]);
	});

	it('los comprados no viajan en el payload y conservan su orden relativo detrás', async () => {
		const familyId = await familyRow('Familia Con Comprados');
		const list = await createList(familyId, LISTA);
		const a = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Pan', unit: 'unit' });
		const b = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Leche' });
		const c = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Huevos', unit: 'dozen' });
		const d = await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Sal', unit: 'gram' });
		// B y D, comprados (la vista los parte; su orden relativo entre sí se
		// conserva: el historial lo congela por ese orden).
		await setItemPurchased(familyId, list.id, b.id, true);
		await setItemPurchased(familyId, list.id, d.id, true);

		// El swap de pendientes: C, A.
		await expect(reorderItems(familyId, list.id, [c.id, a.id])).resolves.toBe(true);

		await expect(ordenDe(list.id)).resolves.toEqual([c.id, a.id, b.id, d.id]);
		// Y la vista sigue agrupando: pendientes (reordenados) y comprados.
		const items = await listItems(familyId, list.id);
		expect(items.map((item) => item.id)).toEqual([c.id, a.id, b.id, d.id]);
	});

	it('ids de otra lista, de otra familia, rancios o repetidos: false y nada cambia', async () => {
		const mia = await familyRow('Familia Propia');
		const ajena = await familyRow('Familia Ajena');
		const propia = await createList(mia, LISTA);
		const parafarmacia = await createList(mia, { ...LISTA, name: 'Parafarmacia' });
		const externa = await createList(ajena, LISTA);
		const a = await createItemOrFail(mia, propia.id, ITEM);
		const b = await createItemOrFail(mia, propia.id, { ...ITEM, name: 'Pan', unit: 'unit' });
		const deOtraLista = await createItemOrFail(mia, parafarmacia.id, ITEM);
		const ajeno = await createItemOrFail(ajena, externa.id, ITEM);

		// El filtro de lista acota dentro de la misma familia…
		await expect(reorderItems(mia, propia.id, [a.id, deOtraLista.id])).resolves.toBe(false);
		// …y el de familia, entre familias. También un id rancio y un
		// payload con repetidos.
		await expect(reorderItems(mia, propia.id, [a.id, ajeno.id])).resolves.toBe(false);
		await expect(reorderItems(mia, propia.id, [a.id, randomUUID()])).resolves.toBe(false);
		await expect(reorderItems(mia, propia.id, [a.id, a.id])).resolves.toBe(false);

		// Nada se tocó.
		await expect(ordenDe(propia.id)).resolves.toEqual([a.id, b.id]);
	});

	it('una lista ajena a la familia es «no existe»: false', async () => {
		const mia = await familyRow('Familia Sola');
		const ajena = await familyRow('Familia Ajena');
		const propia = await createList(mia, LISTA);
		const externa = await createList(ajena, LISTA);
		const propio = await createItemOrFail(mia, propia.id, ITEM);

		// Lista ajena (id rancio o de otra familia): «no existe» en ambos
		// casos, sin revelar si vive en otra parte.
		await expect(reorderItems(mia, externa.id, [propio.id])).resolves.toBe(false);
		await expect(ordenDe(propia.id)).resolves.toEqual([propio.id]);
	});
});

// ---- El CHECK (quantity > 0) de la base (issue #107): el schema zod ya
// rechaza lo que la columna DECIMAL(10,3) no puede guardar bien; el
// constraint es la última defensa para TODO escritor que se salte el schema. ----

describe('CHECK quantity > 0 en la base (#107)', () => {
	it('la base rechaza una cantidad 0 en item, aunque nadie valide antes', async () => {
		const familyId = await familyRow('Familia Check Cero');
		const list = await createList(familyId, LISTA);

		await expect(
			prisma.item.create({
				data: { listId: list.id, name: 'Nada', quantity: 0, unit: 'unit', order: 0 }
			})
		).rejects.toThrow();
		// Y el redondeo traicionero: 0.0001 entra por `positive()` pero la
		// columna lo convertiría en 0 — el CHECK lo corta.
		await expect(
			prisma.item.create({
				data: { listId: list.id, name: 'Migas', quantity: 0.0001, unit: 'gram', order: 1 }
			})
		).rejects.toThrow();
	});

	it('la base rechaza una cantidad 0 en purchaseItem: el snapshot copia la regla', async () => {
		const familyId = await familyRow('Familia Check Snapshot');
		await expect(
			prisma.purchaseRecord.create({
				data: {
					organizationId: familyId,
					listName: 'Compra',
					total: 1,
					items: { create: [{ position: 0, name: 'Nada', quantity: 0, unit: 'unit' }] }
				}
			})
		).rejects.toThrow();
	});

	it('cantidades legales siguen entrando: la milésima justa y el techo de la columna', async () => {
		const familyId = await familyRow('Familia Check Legal');
		const list = await createList(familyId, LISTA);

		const minimo = await prisma.item.create({
			data: { listId: list.id, name: 'Azafrán', quantity: 0.001, unit: 'gram', order: 0 }
		});
		const techo = await prisma.item.create({
			data: { listId: list.id, name: 'Harina', quantity: 9_999_999.999, unit: 'gram', order: 1 }
		});
		expect(Number(minimo.quantity)).toBe(0.001);
		expect(Number(techo.quantity)).toBe(9_999_999.999);
	});
});
