import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): `finalizePurchase` contra
// un Postgres real con las migraciones aplicadas. Como en `items.int.spec.ts`
// no hacen falta sesiones: las familias, listas e items de prueba se crean
// directamente con Prisma y lo que se ejercita es la transacción de finalizar
// compra (issue #70): despensa, historial (#75) y lista depurada, todo a la vez
// — y la protección contra la doble finalización.
import type { ItemData } from '#lib/schemas/item.js';
import { normalizeItemName } from '#lib/normalize-name.js';
import prisma from './prisma.js';
import { createItem, setItemPurchased } from './items.js';
import { createList } from './lists.js';
import {
	finalizePurchase,
	getPurchase,
	listPurchasesByDay,
	listPurchasesByStore,
	MAX_PURCHASES_OFFSET,
	PURCHASES_PAGE_SIZE
} from './purchases.js';
import { createStore } from './stores.js';

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

/**
 * Crea el usuario que finaliza la compra y devuelve su id: `PurchaseRecord`
 * lleva la FK (SetNull) y un id inventado la violaría.
 */
async function userRow(prefix: string): Promise<string> {
	const id = randomUUID();
	await prisma.user.create({
		data: {
			id,
			name: `${prefix} ${id.slice(0, 8)}`,
			email: `${prefix.toLowerCase().replaceAll(' ', '.')}-${id.slice(0, 13)}@example.com`
		}
	});
	return id;
}

/** Datos válidos según `listSchema`, para crear las listas de prueba. */
const LIST = { name: 'Compra semanal', color: 'yellow', icon: 'shopping-basket' } as const;

/** Datos válidos según `itemSchema`, para mutar campo a campo en cada spec. */
const ITEM: ItemData = { name: 'Leche entera', quantity: 2, unit: 'liter' };

/**
 * Crea un item para montar el escenario y lo marca como comprado si toca;
 * falla el test si no se creó (el `null` de lista ajena lo ejercita su propio
 * spec, aquí es ruido).
 */
async function createItemOrFail(
	familyId: string,
	listId: string,
	data: ItemData,
	purchased = false
) {
	const created = await createItem(familyId, listId, data);
	if (!created) {
		throw new Error('El item no se creó: la lista no pertenece a la familia');
	}
	if (purchased) {
		await setItemPurchased(familyId, listId, created.id, true);
	}
	return created;
}

/** La fila del historial con sus items snapshot. */
async function purchaseWithItems(familyId: string) {
	return prisma.purchaseRecord.findFirstOrThrow({
		where: { organizationId: familyId },
		include: { items: { orderBy: { name: 'asc' } } }
	});
}

describe('Finalizar compra: comprados a despensa, fuera de la lista (#70)', () => {
	it('mueve los comprados a la despensa, quita solo los comprados y conserva la lista con los pendientes', async () => {
		const familyId = await familyRow('Familia Finalizando');
		const list = await createList(familyId, LIST);
		const pan = await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Pan', quantity: 1, unit: 'unit' },
			true
		);
		const leche = await createItemOrFail(familyId, list.id, { ...ITEM, quantity: 1.5 }, true);
		const huevos = await createItemOrFail(familyId, list.id, {
			name: 'Huevos',
			quantity: 1,
			unit: 'dozen'
		});

		const userId = await userRow('Quien Finaliza');
		expect(await finalizePurchase(familyId, list.id, 42.67, userId)).toBe('finalized');

		// Despensa: un row por producto comprado, con el nombre tal cual se
		// escribió en la lista y su canónico al lado; la cantidad es Decimal.
		const pantry = await prisma.pantryItem.findMany({
			where: { organizationId: familyId },
			orderBy: { name: 'asc' }
		});
		expect(pantry.map((row) => row.name)).toEqual(['Leche entera', 'Pan']);
		expect(pantry.map((row) => row.normalizedName)).toEqual(['leche entera', 'pan']);
		expect(pantry.map((row) => Number(row.quantity))).toEqual([1.5, 1]);

		// La lista NO se borra: sigue existiendo y solo conserva los
		// pendientes, sin cambios (criterio de aceptación de la #43).
		expect(await prisma.list.findUnique({ where: { id: list.id } })).not.toBeNull();
		const remaining = await prisma.item.findMany({ where: { listId: list.id } });
		expect(remaining.map((row) => row.id)).toEqual([huevos.id]);
		expect((await prisma.item.findUnique({ where: { id: huevos.id } }))?.purchased).toBe(false);

		// Los comprados ya no están.
		expect(await prisma.item.findMany({ where: { id: { in: [pan.id, leche.id] } } })).toHaveLength(
			0
		);

		// Historial (#75): snapshot de la lista y de los items, total a mano y
		// quién finalizó.
		const purchase = await purchaseWithItems(familyId);
		expect(purchase.listId).toBe(list.id);
		expect(purchase.listName).toBe(LIST.name);
		expect(Number(purchase.total)).toBe(42.67);
		expect(purchase.userId).toBe(userId);
		expect(purchase.items.map((row) => [row.name, Number(row.quantity), row.unit])).toEqual([
			['Leche entera', 1.5, 'liter'],
			['Pan', 1, 'unit']
		]);
	});

	it('suma cantidades cuando el producto ya estaba en la despensa (mismo canónico y unidad), y separa por unidad', async () => {
		const familyId = await familyRow('Familia Repetidora');
		const list = await createList(familyId, LIST);

		// En despensa ya hay «Leche Entera» en litros: otra escritura del mismo
		// producto («leche entera», sin mayúsculas) debe SUMAR, conservando el
		// nombre que ya tenía la despensa.
		await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Leche Entera',
				normalizedName: normalizeItemName('Leche Entera'),
				quantity: 1.25,
				unit: 'liter'
			}
		});

		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'leche entera', quantity: 0.5, unit: 'liter' },
			true
		);
		// Misma escritura pero en gramos: OTRA fila de despensa, no se mezcla.
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'leche entera', quantity: 250, unit: 'gram' },
			true
		);

		expect(await finalizePurchase(familyId, list.id, 10, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const pantry = await prisma.pantryItem.findMany({
			where: { organizationId: familyId },
			orderBy: { unit: 'asc' }
		});
		expect(pantry).toHaveLength(2);
		const liters = pantry.find((row) => row.unit === 'liter');
		const gramos = pantry.find((row) => row.unit === 'gram');
		expect(Number(liters?.quantity)).toBe(1.75);
		// El nombre visible lo puso la primera vez: no lo machaca la compra.
		expect(liters?.name).toBe('Leche Entera');
		expect(Number(gramos?.quantity)).toBe(250);
	});

	it('dos comprados con el mismo canónico en la MISMA lista aterrizan sumados en un solo row', async () => {
		const familyId = await familyRow('Familia Duplicada');
		const list = await createList(familyId, LIST);
		await createItemOrFail(familyId, list.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);
		await createItemOrFail(familyId, list.id, { name: 'pan', quantity: 2, unit: 'unit' }, true);

		expect(await finalizePurchase(familyId, list.id, 3, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const pantry = await prisma.pantryItem.findMany({ where: { organizationId: familyId } });
		expect(pantry).toHaveLength(1);
		expect(Number(pantry[0].quantity)).toBe(3);
	});

	it('los espacios internos repetidos no parten el producto (#107): «Leche  entera» y «Leche entera» suman', async () => {
		const familyId = await familyRow('Familia Espaciada');
		const list = await createList(familyId, LIST);
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Leche  entera', quantity: 1, unit: 'liter' },
			true
		);
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Leche entera', quantity: 1, unit: 'liter' },
			true
		);

		expect(await finalizePurchase(familyId, list.id, 2, await userRow('Comprador'))).toBe(
			'finalized'
		);

		// Antes eran DOS filas de despensa que no se sumaban al re-añadir: el
		// canónico colapsa ahora los espacios internos y aterrizan en UNA.
		const pantry = await prisma.pantryItem.findMany({ where: { organizationId: familyId } });
		expect(pantry).toHaveLength(1);
		expect(pantry[0].normalizedName).toBe('leche entera');
		expect(Number(pantry[0].quantity)).toBe(2);
	});
});

describe('Finalizar compra: guardas (#70)', () => {
	it('sin items comprados no finaliza: `nothing-purchased` y nada cambia', async () => {
		const familyId = await familyRow('Familia Sin Comprados');
		const list = await createList(familyId, LIST);
		await createItemOrFail(familyId, list.id, ITEM);
		await createItemOrFail(familyId, list.id, { ...ITEM, name: 'Pan', unit: 'unit' });
		await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Sal',
				normalizedName: 'sal',
				quantity: 1,
				unit: 'unit'
			}
		});

		expect(await finalizePurchase(familyId, list.id, 5, await userRow('Impaciente'))).toBe(
			'nothing-purchased'
		);

		// Sin historial, despensa intacta y los items siguen en la lista.
		expect(
			await prisma.purchaseRecord.findMany({ where: { organizationId: familyId } })
		).toHaveLength(0);
		expect(await prisma.item.findMany({ where: { listId: list.id } })).toHaveLength(2);
		expect(await prisma.pantryItem.findMany({ where: { organizationId: familyId } })).toHaveLength(
			1
		);
	});

	it('una lista ajena a la familia es «no existe»: `list-gone` y no toca nada suyo', async () => {
		const ownFamily = await familyRow('Familia Curiosa');
		const otherFamily = await familyRow('Familia Intacta');
		const externalFamily = await createList(otherFamily, LIST);
		const foreignItem = await createItemOrFail(otherFamily, externalFamily.id, ITEM, true);

		expect(await finalizePurchase(ownFamily, externalFamily.id, 5, await userRow('Curioso'))).toBe(
			'list-gone'
		);

		// La compra de la familia ajena sigue exactamente igual.
		expect(await prisma.item.findUnique({ where: { id: foreignItem.id } })).not.toBeNull();
		expect(
			await prisma.purchaseRecord.findMany({ where: { organizationId: otherFamily } })
		).toHaveLength(0);
		expect(await prisma.pantryItem.findMany({ where: { organizationId: ownFamily } })).toHaveLength(
			0
		);
	});

	it('finalizar dos veces seguidas no duplica: la segunda es `nothing-purchased`', async () => {
		const familyId = await familyRow('Familia Repetida');
		const list = await createList(familyId, LIST);
		await createItemOrFail(familyId, list.id, { ...ITEM, quantity: 2 }, true);

		const first = await userRow('Primero');
		const second = await userRow('Segundo');
		expect(await finalizePurchase(familyId, list.id, 10, first)).toBe('finalized');
		// Doble click: la segunda pasada ya no encuentra comprados.
		expect(await finalizePurchase(familyId, list.id, 10, second)).toBe('nothing-purchased');

		expect(
			await prisma.purchaseRecord.findMany({ where: { organizationId: familyId } })
		).toHaveLength(1);
		const pantry = await prisma.pantryItem.findMany({ where: { organizationId: familyId } });
		expect(pantry).toHaveLength(1);
		expect(Number(pantry[0].quantity)).toBe(2);
	});

	it('dos miembros que finalizan A LA VEZ: exactamente uno gana y la despensa suma una vez', async () => {
		const familyId = await familyRow('Familia a la Vez');
		const list = await createList(familyId, LIST);
		await createItemOrFail(familyId, list.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);
		await createItemOrFail(familyId, list.id, { ...ITEM, quantity: 0.5 }, true);

		// Dos peticiones concurrentes (doble click, dos miembros): los locks
		// FOR UPDATE dejan pasar a una y la otra se queda sin filas que
		// reclamar, SIN rastro.
		const outcomes = await Promise.all([
			finalizePurchase(familyId, list.id, 20, await userRow('Miembro Uno')),
			finalizePurchase(familyId, list.id, 25, await userRow('Miembro Dos'))
		]);
		expect(outcomes.filter((outcome) => outcome === 'finalized')).toHaveLength(1);
		expect(outcomes.filter((outcome) => outcome === 'nothing-purchased')).toHaveLength(1);

		// Un solo historial, despensa sumada UNA vez, items fuera de la lista.
		expect(
			await prisma.purchaseRecord.findMany({ where: { organizationId: familyId } })
		).toHaveLength(1);
		const pantry = await prisma.pantryItem.findMany({
			where: { organizationId: familyId },
			orderBy: { name: 'asc' }
		});
		expect(pantry.map((row) => [row.name, Number(row.quantity)])).toEqual([
			['Leche entera', 0.5],
			['Pan', 1]
		]);
		expect(await prisma.item.findMany({ where: { listId: list.id } })).toHaveLength(0);
	});

	it('dos listas con los mismos productos en ORDEN INVERSO finalizan a la vez sin deadlock (#108)', async () => {
		// El upsert de despensa anterior seguía el orden de un findMany sin
		// orderBy: {leche, pan} contra {pan, leche} podía bloquear las filas
		// de despensa en orden inverso y Postgres abortaba a uno (40P01), que
		// el usuario veía como `purchases_error`. El bucle canónico ordenado
		// lo hace imposible: las dos transacciones piden las filas en el
		// MISMO orden, una espera a la otra y las dos terminan bien.
		const familyId = await familyRow('Familia Cruzada');
		const first = await createList(familyId, LIST);
		const second = await createList(familyId, { ...LIST, name: 'Compra cruzada' });
		await createItemOrFail(familyId, first.id, { ...ITEM, quantity: 1.5 }, true);
		await createItemOrFail(familyId, first.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);
		await createItemOrFail(familyId, second.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);
		await createItemOrFail(familyId, second.id, { ...ITEM, quantity: 1 }, true);

		const outcomes = await Promise.all([
			finalizePurchase(familyId, first.id, 10, await userRow('Comprador Uno')),
			finalizePurchase(familyId, second.id, 12, await userRow('Comprador Dos'))
		]);
		expect(outcomes).toEqual(['finalized', 'finalized']);

		// Despensa sumada de las dos compras, sin duplicados; dos historiales.
		const pantry = await prisma.pantryItem.findMany({
			where: { organizationId: familyId },
			orderBy: { name: 'asc' }
		});
		expect(pantry.map((row) => [row.name, Number(row.quantity)])).toEqual([
			['Leche entera', 2.5],
			['Pan', 2]
		]);
		expect(
			await prisma.purchaseRecord.findMany({ where: { organizationId: familyId } })
		).toHaveLength(2);
	});
});

// ---- Herencia de categoría al finalizar compra (#175): la despensa solo
// toma la categoría del item si el producto no tenía ya una — la existente
// siempre gana —, y el snapshot del historial congela la categoría del
// momento por id y por nombre. ----

/** Crea una categoría de la familia directamente en la base. */
async function categoryRow(familyId: string, name: string, position = 0) {
	return prisma.category.create({
		data: {
			organizationId: familyId,
			name,
			// El canónico lo calcula el test con el mismo `normalizeItemName`
			// del servidor (el `createCategory` real lo ejercita su propio spec).
			normalizedName: normalizeItemName(name),
			position
		}
	});
}

describe('Finalizar compra: herencia de categoría y snapshot (#175)', () => {
	it('el producto NUEVO aterriza con la categoría del item; sin categoría se queda sin ella', async () => {
		const familyId = await familyRow('Familia Heredera');
		const list = await createList(familyId, LIST);
		const dairy = await categoryRow(familyId, 'Lácteos');
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Yogur', quantity: 4, unit: 'unit', categoryId: dairy.id },
			true
		);
		await createItemOrFail(familyId, list.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);

		expect(await finalizePurchase(familyId, list.id, 6, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const pantry = await prisma.pantryItem.findMany({
			where: { organizationId: familyId },
			orderBy: { name: 'asc' }
		});
		expect(pantry.map((row) => [row.name, row.categoryId])).toEqual([
			['Pan', null],
			['Yogur', dairy.id]
		]);
	});

	it('el producto que YA tenía categoría la conserva aunque la compra traiga otra, y suma', async () => {
		const familyId = await familyRow('Familia Fiel');
		const list = await createList(familyId, LIST);
		const old = await categoryRow(familyId, 'Desayuno');
		const newCategory = await categoryRow(familyId, 'Lácteos', 1);
		await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Leche Entera',
				normalizedName: normalizeItemName('Leche Entera'),
				quantity: 1,
				unit: 'liter',
				categoryId: old.id
			}
		});
		// El item trae OTRA categoría (Lácteos): recategorizar no es cosa de
		// la compra — gana la existente del producto.
		await createItemOrFail(familyId, list.id, { ...ITEM, categoryId: newCategory.id }, true);

		expect(await finalizePurchase(familyId, list.id, 3, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const leche = await prisma.pantryItem.findFirstOrThrow({
			where: { organizationId: familyId, normalizedName: 'leche entera' }
		});
		expect(leche.categoryId).toBe(old.id);
		expect(leche.name).toBe('Leche Entera');
		expect(Number(leche.quantity)).toBe(3);
	});

	it('el producto SIN categoría hereda la de la compra, sin tocar nombre ni cantidad previa', async () => {
		const familyId = await familyRow('Familia Huérfana');
		const list = await createList(familyId, LIST);
		const dairy = await categoryRow(familyId, 'Lácteos');
		await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Yogur',
				normalizedName: 'yogur',
				quantity: 2,
				unit: 'unit'
			}
		});
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Yogur', quantity: 4, unit: 'unit', categoryId: dairy.id },
			true
		);

		expect(await finalizePurchase(familyId, list.id, 4, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const yogur = await prisma.pantryItem.findFirstOrThrow({
			where: { organizationId: familyId, normalizedName: 'yogur' }
		});
		expect(yogur.categoryId).toBe(dairy.id);
		expect(yogur.name).toBe('Yogur');
		expect(Number(yogur.quantity)).toBe(6);
	});

	it('la compra sin categorías no descategoriza lo que ya tenía', async () => {
		const familyId = await familyRow('Familia Sin Categorías');
		const list = await createList(familyId, LIST);
		const dairy = await categoryRow(familyId, 'Lácteos');
		await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Yogur',
				normalizedName: 'yogur',
				quantity: 1,
				unit: 'unit',
				categoryId: dairy.id
			}
		});
		await createItemOrFail(familyId, list.id, { name: 'Yogur', quantity: 2, unit: 'unit' }, true);

		expect(await finalizePurchase(familyId, list.id, 2, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const yogur = await prisma.pantryItem.findFirstOrThrow({
			where: { organizationId: familyId, normalizedName: 'yogur' }
		});
		expect(yogur.categoryId).toBe(dairy.id);
		expect(Number(yogur.quantity)).toBe(3);
	});

	it('dos comprados del MISMO producto con categorías distintas: gana la primera del orden canónico', async () => {
		const familyId = await familyRow('Familia Dúplex');
		const list = await createList(familyId, LIST);
		const first = await categoryRow(familyId, 'Lácteos');
		const second = await categoryRow(familyId, 'Desayuno', 1);
		// Mismo producto (canónico y unidad) en dos filas con categorías
		// distintas: aterrizan juntos en UN producto y la categoría la fija
		// el primero del orden — los gemelos de producto empatan en el
		// canónico, así que manda el primero de la lista.
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Leche entera', quantity: 1, unit: 'liter', categoryId: first.id },
			true
		);
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'leche entera', quantity: 1, unit: 'liter', categoryId: second.id },
			true
		);

		expect(await finalizePurchase(familyId, list.id, 2, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const pantry = await prisma.pantryItem.findMany({ where: { organizationId: familyId } });
		expect(pantry).toHaveLength(1);
		expect(pantry[0].categoryId).toBe(first.id);
		expect(Number(pantry[0].quantity)).toBe(2);
	});

	it('el snapshot del historial congela la categoría por id y por nombre, fiel a lo comprado', async () => {
		const familyId = await familyRow('Familia Congelada');
		const list = await createList(familyId, LIST);
		const dairy = await categoryRow(familyId, 'Lácteos');
		await createItemOrFail(familyId, list.id, { ...ITEM, categoryId: dairy.id }, true);
		await createItemOrFail(familyId, list.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);

		expect(await finalizePurchase(familyId, list.id, 4, await userRow('Comprador'))).toBe(
			'finalized'
		);

		// El snapshot guarda la categoría del momento: id y nombre visible,
		// como el `listName` congela el de la lista.
		const purchase = await purchaseWithItems(familyId);
		const [leche, pan] = purchase.items;
		expect(leche).toMatchObject({
			name: 'Leche entera',
			categoryId: dairy.id,
			categoryName: 'Lácteos'
		});
		expect(pan).toMatchObject({ name: 'Pan', categoryId: null, categoryName: null });

		// Fiel a lo comprado aunque el presente cambie: recategorizar el
		// producto de la despensa DESPUÉS no retoca el historial (el SetNull
		// del borrado de categorías lo ejercita `categories.int.spec.ts`).
		const product = await prisma.pantryItem.findFirstOrThrow({
			where: { organizationId: familyId, normalizedName: 'leche entera' }
		});
		const breakfast = await categoryRow(familyId, 'Desayuno', 1);
		await prisma.pantryItem.update({
			where: { id: product.id },
			data: { categoryId: breakfast.id }
		});
		const after = await purchaseWithItems(familyId);
		expect(after.items[0]).toMatchObject({
			name: 'Leche entera',
			categoryId: dairy.id,
			categoryName: 'Lácteos'
		});
	});
});

// ---- Establecimiento en el historial (#185): la compra congela por id y
// nombre visible la tienda de la familia elegida en el modal de finalizar,
// o no lleva ninguna; un id ajeno o rancio NO cierra la compra. ----

describe('Finalizar compra: establecimiento (#185)', () => {
	it('la compra con establecimiento congela id y nombre; borrarlo después solo le quita el id', async () => {
		const familyId = await familyRow('Familia Establecida');
		const list = await createList(familyId, LIST);
		const mercadona = await createStore(familyId, { name: 'Mercadona' });
		await createItemOrFail(familyId, list.id, { ...ITEM, quantity: 1.5 }, true);

		expect(
			await finalizePurchase(familyId, list.id, 12.3, await userRow('Comprador'), mercadona.id)
		).toBe('finalized');

		// El snapshot guarda la tienda DEL MOMENTO: id para la FK y nombre
		// visible congelado, como el `listName` congela el de la lista.
		const purchase = await purchaseWithItems(familyId);
		expect(purchase).toMatchObject({ storeId: mercadona.id, storeName: 'Mercadona' });

		// Renombrarla después no retoca el historial; borrarla le quita el id
		// (SetNull) pero el nombre congelado sobrevive en el ticket.
		await prisma.store.update({ where: { id: mercadona.id }, data: { name: 'Mercadona SA' } });
		await prisma.store.delete({ where: { id: mercadona.id } });
		const after = await purchaseWithItems(familyId);
		expect(after).toMatchObject({ storeId: null, storeName: 'Mercadona' });
	});

	it('la compra sin establecimiento no lleva ni id ni nombre', async () => {
		const familyId = await familyRow('Familia Anónima');
		const list = await createList(familyId, LIST);
		// La familia SÍ tiene tiendas: no llevar establecimiento es una
		// decisión del formulario («Sin establecimiento»), no una ausencia.
		await createStore(familyId, { name: 'Lidl' });
		await createItemOrFail(familyId, list.id, { ...ITEM }, true);

		expect(await finalizePurchase(familyId, list.id, 5, await userRow('Comprador'))).toBe(
			'finalized'
		);
		expect(await purchaseWithItems(familyId)).toMatchObject({ storeId: null, storeName: null });
	});

	it('un id ajeno o rancio NO cierra la compra: `store-gone` y sin rastro', async () => {
		const familyId = await familyRow('Familia Exigente');
		const list = await createList(familyId, LIST);
		const pan = await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Pan', quantity: 1, unit: 'unit' },
			true
		);

		// Rancio: la tienda existió y la borraron mientras se rellenaba el modal.
		const ephemeral = await createStore(familyId, { name: 'Chino de antes' });
		await prisma.store.delete({ where: { id: ephemeral.id } });
		expect(
			await finalizePurchase(familyId, list.id, 5, await userRow('Comprador'), ephemeral.id)
		).toBe('store-gone');

		// Ajeno: un id de OTRA familia es igual de «no existe aquí».
		const otherFamily = await familyRow('Familia Tendera');
		const foreignItem = await createStore(otherFamily, { name: 'Mercadona ajeno' });
		expect(
			await finalizePurchase(familyId, list.id, 5, await userRow('Comprador'), foreignItem.id)
		).toBe('store-gone');

		// Nada se cerró: los comprados siguen en la lista, sin historial ni
		// despensa.
		expect(await prisma.item.findUnique({ where: { id: pan.id } })).not.toBeNull();
		expect(
			await prisma.purchaseRecord.findMany({ where: { organizationId: familyId } })
		).toHaveLength(0);
		expect(await prisma.pantryItem.findMany({ where: { organizationId: familyId } })).toHaveLength(
			0
		);
	});
});

// ---- Historial (issues #47 y #76), agrupado por establecimiento (#187): la
// consulta del snapshot que deja `finalizePurchase`. Las compras de prueba se
// siembran a mano con `createdAt` explícitos: es el único modo de controlar
// el orden de secciones y la paginación sin depender del reloj. ----

/** Siembra una compra con su snapshot, como la deja `finalizePurchase`. */
async function purchaseRow(
	familyId: string,
	options: {
		listName: string;
		total: number;
		createdAt: Date;
		/** El establecimiento del snapshot (#187): id + nombre congelados. */
		storeId?: string;
		storeName?: string | null;
		/** Los items del snapshot; si se omite, uno solo de relleno. */
		items?: Array<{ name: string; quantity: number; unit: ItemData['unit'] }>;
		listId?: string;
	}
) {
	return prisma.purchaseRecord.create({
		data: {
			organizationId: familyId,
			listId: options.listId,
			listName: options.listName,
			storeId: options.storeId,
			storeName: options.storeName,
			total: options.total,
			createdAt: options.createdAt,
			items: {
				create: (options.items ?? [{ name: 'Producto', quantity: 1, unit: 'unit' }]).map(
					(item, position) => ({
						position,
						name: item.name,
						quantity: item.quantity,
						unit: item.unit
					})
				)
			}
		}
	});
}

// ---- El listado agrupado por establecimiento (#187): orden de secciones por
// la compra más reciente de cada tienda, orden por fecha dentro de la suya,
// «Sin establecimiento» al final y paginación acumulativa por bloque. ----

describe('Historial: listado agrupado por establecimiento (#187)', () => {
	it('agrupa por establecimiento: secciones por su compra más reciente, compras por fecha dentro y «Sin establecimiento» al final', async () => {
		const familyId = await familyRow('Familia Agrupada');
		const mercadona = await createStore(familyId, { name: 'Mercadona' });
		const lidl = await createStore(familyId, { name: 'Lidl' });
		await purchaseRow(familyId, {
			listName: 'Compra Mercadona nueva',
			total: 20,
			createdAt: new Date('2026-06-10T10:00:00Z'),
			storeId: mercadona.id,
			storeName: mercadona.name
		});
		await purchaseRow(familyId, {
			listName: 'Compra Mercadona vieja',
			total: 15,
			createdAt: new Date('2026-03-01T10:00:00Z'),
			storeId: mercadona.id,
			storeName: mercadona.name
		});
		await purchaseRow(familyId, {
			listName: 'Compra Lidl',
			total: 30,
			createdAt: new Date('2026-06-15T10:00:00Z'),
			storeId: lidl.id,
			storeName: lidl.name
		});
		// Sin establecimiento, con la compra MÁS NUEVA de todas: su bloque va
		// igualmente al final — es bloque propio, no una sección más (#187).
		await purchaseRow(familyId, {
			listName: 'Compra suelta nueva',
			total: 5,
			createdAt: new Date('2026-07-20T10:00:00Z')
		});
		await purchaseRow(familyId, {
			listName: 'Compra suelta vieja',
			total: 8,
			createdAt: new Date('2026-01-05T10:00:00Z')
		});

		// El historial es por familia (criterio de la #33): la compra de otra
		// no aparece, como si no existiera.
		const otherFamily = await familyRow('Familia Agrupada Ajena');
		await purchaseRow(otherFamily, {
			listName: 'Caviar ajeno',
			total: 99,
			createdAt: new Date('2026-06-16T10:00:00Z')
		});

		const { groups } = await listPurchasesByStore(familyId);

		// Secciones por su compra más reciente: Lidl (15 jun) sobre Mercadona
		// (10 jun), y «Sin establecimiento» al final aunque su compra sea la
		// más nueva. La clave de una sección viva es el id de la tienda; su
		// título, el nombre visible.
		expect(groups.map((group) => [group.key, group.storeName])).toEqual([
			[lidl.id, 'Lidl'],
			[mercadona.id, 'Mercadona'],
			['none', null]
		]);
		// Dentro de cada sección, de la más reciente a la más antigua.
		expect(groups.map((group) => group.purchases.map((row) => row.listName))).toEqual([
			['Compra Lidl'],
			['Compra Mercadona nueva', 'Compra Mercadona vieja'],
			['Compra suelta nueva', 'Compra suelta vieja']
		]);
		// Ni historia detrás ni offset pedido en la primera página.
		expect(groups.map((group) => [group.offset, group.hasMore])).toEqual([
			[0, false],
			[0, false],
			[0, false]
		]);
	});

	it('la paginación es ACUMULATIVA por sección: la página de un offset incluye todo lo anterior de SU bloque, sin tocar las demás', async () => {
		const familyId = await familyRow('Familia Paginada Agrupada');
		const mercadona = await createStore(familyId, { name: 'Mercadona' });
		const lidl = await createStore(familyId, { name: 'Lidl' });
		const total = PURCHASES_PAGE_SIZE + 5;
		for (let i = 0; i < total; i++) {
			// createdAt crecientes: la compra i+1 es la más nueva de las i+1.
			await purchaseRow(familyId, {
				listName: `Compra Mercadona ${i + 1}`,
				total: i,
				createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
				storeId: mercadona.id,
				storeName: mercadona.name
			});
		}
		await purchaseRow(familyId, {
			listName: 'Compra Lidl',
			total: 1,
			createdAt: new Date('2026-02-01T10:00:00Z'),
			storeId: lidl.id,
			storeName: lidl.name
		});

		const first = await listPurchasesByStore(familyId);
		const suMercadona = first.groups.find((group) => group.key === mercadona.id);
		expect(suMercadona?.purchases).toHaveLength(PURCHASES_PAGE_SIZE);
		expect(suMercadona?.hasMore).toBe(true);
		// La más nueva primero: la última sembrada.
		expect(suMercadona?.purchases[0].listName).toBe(`Compra Mercadona ${total}`);
		// La sección del Lidl, completa e intacta.
		expect(first.groups.find((group) => group.key === lidl.id)?.purchases).toHaveLength(1);

		// La «segunda página» de Mercadona trae TODO lo suyo, no solo sus 5
		// filas: es lo que hace que «Cargar más» añada al final de lo pintado.
		// El offset de Lidl no viaja: su sección se sirve entera igual.
		const grown = await listPurchasesByStore(familyId, { [mercadona.id]: PURCHASES_PAGE_SIZE });
		const grownMercadona = grown.groups.find((group) => group.key === mercadona.id);
		expect(grownMercadona?.purchases).toHaveLength(total);
		expect(grownMercadona?.hasMore).toBe(false);
		// Las filas ya vistas no cambian de sitio ni de contenido.
		expect(grownMercadona?.purchases.slice(0, PURCHASES_PAGE_SIZE)).toEqual(suMercadona?.purchases);
		expect(grown.groups.find((group) => group.key === lidl.id)?.purchases).toHaveLength(1);
	});

	it('un offset basura o negativo es la primera página del bloque, y uno desmedido se acota POR SECCIÓN (#109)', async () => {
		const familyId = await familyRow('Familia Offset Basura');
		const mercadona = await createStore(familyId, { name: 'Mercadona' });
		await purchaseRow(familyId, {
			listName: 'De tienda',
			total: 1,
			createdAt: new Date('2026-03-01T10:00:00Z'),
			storeId: mercadona.id,
			storeName: mercadona.name
		});
		await purchaseRow(familyId, {
			listName: 'Única suelta',
			total: 2,
			createdAt: new Date('2026-03-02T10:00:00Z')
		});

		const basura = await listPurchasesByStore(familyId, { [mercadona.id]: Number.NaN });
		expect(basura.groups.find((group) => group.key === mercadona.id)?.purchases).toHaveLength(1);
		const negative = await listPurchasesByStore(familyId, { [mercadona.id]: -5 });
		expect(negative.groups.find((group) => group.key === mercadona.id)?.purchases).toHaveLength(1);

		// Sin acotar, `1e21` pasaba Number.isInteger y el `take` desmedido
		// reventaba Prisma (500); un millón volcaba la sección entera. El tope
		// es POR BLOQUE: cada sección acota el suyo, sea de tienda o el final.
		const capped = await listPurchasesByStore(familyId, { [mercadona.id]: 1e21 });
		expect(() => listPurchasesByStore(familyId, { [mercadona.id]: 1e21 })).not.toThrow();
		const itsSection = capped.groups.find((group) => group.key === mercadona.id);
		expect(itsSection?.purchases).toHaveLength(1);
		expect(itsSection?.offset).toBe(MAX_PURCHASES_OFFSET);
		expect(
			(await listPurchasesByStore(familyId, { [mercadona.id]: 1_000_000 })).groups.find(
				(group) => group.key === mercadona.id
			)
		).toEqual(itsSection);
		expect(
			(await listPurchasesByStore(familyId, { [mercadona.id]: MAX_PURCHASES_OFFSET })).groups.find(
				(group) => group.key === mercadona.id
			)
		).toEqual(itsSection);

		// El bloque de «Sin establecimiento» acota el suyo con la misma regla.
		const { groups } = await listPurchasesByStore(familyId);
		const withoutSection = groups.find((group) => group.storeName === null);
		expect(withoutSection).toBeDefined();
		const cappedWithout = await listPurchasesByStore(familyId, { [withoutSection!.key]: 1e21 });
		expect(cappedWithout.groups.find((group) => group.storeName === null)?.offset).toBe(
			MAX_PURCHASES_OFFSET
		);
	});

	it('el establecimiento borrado deja sus compras juntas bajo el nombre del snapshot, y «Sin establecimiento» sigue al final', async () => {
		const familyId = await familyRow('Familia Tienda Muerta');
		const mercadona = await createStore(familyId, { name: 'Mercadona' });
		await purchaseRow(familyId, {
			listName: 'Compra tras el borrado',
			total: 20,
			createdAt: new Date('2026-06-10T10:00:00Z'),
			storeId: mercadona.id,
			storeName: mercadona.name
		});
		await purchaseRow(familyId, {
			listName: 'Compra antes del borrado',
			total: 15,
			createdAt: new Date('2026-03-01T10:00:00Z'),
			storeId: mercadona.id,
			storeName: mercadona.name
		});
		// Sin establecimiento y además la compra MÁS NUEVA de todas: el bloque
		// «Sin establecimiento» va al final igualmente.
		await purchaseRow(familyId, {
			listName: 'Compra suelta',
			total: 5,
			createdAt: new Date('2026-07-20T10:00:00Z')
		});

		// Borrar el establecimiento le quita la FK a las compras (SetNull,
		// tarea #179) pero el nombre congelado sobrevive en el snapshot.
		await prisma.store.delete({ where: { id: mercadona.id } });

		const { groups } = await listPurchasesByStore(familyId);
		expect(groups.map((group) => [group.key, group.storeName])).toEqual([
			[`name:${mercadona.name}`, 'Mercadona'],
			['none', null]
		]);
		expect(groups[0].purchases.map((row) => row.listName)).toEqual([
			'Compra tras el borrado',
			'Compra antes del borrado'
		]);
		expect(groups[1].purchases.map((row) => row.listName)).toEqual(['Compra suelta']);
	});
});

describe('Historial: detalle de una compra (#76)', () => {
	it('el detalle sale en el orden CONGELADO por `position`, no alfabético ni físico (#109)', async () => {
		const familyId = await familyRow('Familia Detalle Ordenado');
		// En la lista se compró primero Pan y luego Leche: el snapshot congela
		// ese orden aunque no sea alfabético ni el que Postgres devuelva «de
		// oído» (el orden físico de inserción no está prometido).
		const list = await createList(familyId, LIST);
		const purchase = await purchaseRow(familyId, {
			listId: list.id,
			listName: LIST.name,
			total: 5,
			createdAt: new Date('2026-06-01T10:00:00Z'),
			items: [
				{ name: 'Pan', quantity: 1, unit: 'unit' },
				{ name: 'Leche entera', quantity: 1.5, unit: 'liter' }
			]
		});

		const detail = await getPurchase(familyId, purchase.id);
		expect(detail?.items.map((item) => item.name)).toEqual(['Pan', 'Leche entera']);
	});

	it('el detalle lleva el establecimiento del snapshot (#187) y sobrevive a que se borre', async () => {
		const familyId = await familyRow('Familia Ticket Establecido');
		const mercadona = await createStore(familyId, { name: 'Mercadona' });
		const purchase = await purchaseRow(familyId, {
			listName: 'Compra con tienda',
			total: 20,
			createdAt: new Date('2026-06-10T10:00:00Z'),
			storeId: mercadona.id,
			storeName: mercadona.name
		});
		const standalone = await purchaseRow(familyId, {
			listName: 'Compra sin tienda',
			total: 5,
			createdAt: new Date('2026-06-11T10:00:00Z')
		});

		expect((await getPurchase(familyId, purchase.id))?.storeName).toBe('Mercadona');
		expect((await getPurchase(familyId, standalone.id))?.storeName).toBeNull();

		// Fiel a lo comprado aunque el presente cambie: renombrar la tienda y
		// borrarla (SetNull) no retoca el ticket — el nombre congelado queda.
		await prisma.store.update({ where: { id: mercadona.id }, data: { name: 'Mercadona SA' } });
		await prisma.store.delete({ where: { id: mercadona.id } });
		expect((await getPurchase(familyId, purchase.id))?.storeName).toBe('Mercadona');
	});

	it('devuelve el snapshot completo: items congelados, total a mano y nombre de lista guardado', async () => {
		const familyId = await familyRow('Familia Detallada');
		const list = await createList(familyId, LIST);
		const purchase = await purchaseRow(familyId, {
			listId: list.id,
			listName: LIST.name,
			total: 42.67,
			createdAt: new Date('2026-06-01T10:00:00Z'),
			items: [
				{ name: 'Leche entera', quantity: 1.5, unit: 'liter' },
				{ name: 'Pan', quantity: 1, unit: 'unit' }
			]
		});

		const detail = await getPurchase(familyId, purchase.id);
		expect(detail?.listName).toBe(LIST.name);
		expect(detail?.total).toBe(42.67);
		expect(detail?.items.map((item) => [item.name, item.quantity, item.unit])).toEqual([
			['Leche entera', 1.5, 'liter'],
			['Pan', 1, 'unit']
		]);

		// El snapshot no le afecta el presente (#33): renombrar la lista de
		// origen y añadirle items no altera el detalle de la compra.
		await prisma.list.update({ where: { id: list.id }, data: { name: 'Renombrada' } });
		await createItem(familyId, list.id, { name: 'Nuevo', quantity: 1, unit: 'unit' });
		const after = await getPurchase(familyId, purchase.id);
		expect(after?.listName).toBe(LIST.name);
		expect(after?.items).toHaveLength(2);
	});

	it('la compra de otra familia es como si no existiera', async () => {
		const familyId = await familyRow('Familia Detalle Propia');
		const otherFamily = await familyRow('Familia Detalle Ajena');
		const purchase = await purchaseRow(otherFamily, {
			listName: 'Ajena',
			total: 5,
			createdAt: new Date('2026-06-01T10:00:00Z')
		});

		expect(await getPurchase(familyId, purchase.id)).toBeNull();
		// Un id inventado tampoco: sin revelar si vive en otra parte.
		expect(await getPurchase(familyId, 'no-existe')).toBeNull();
	});
});

// ---- Gastos por día del calendario (épica #212, tarea #219): el total de
// cada día del mes y sus compras para el detalle. `createdAt` es TIMESTAMPTZ,
// así que las compras de prueba fijan instantes UTC concretos para ejercitar
// el desplazamiento a Europe/Madrid (una 00:30 española son UTC de la
// víspera, con y sin horario de verano) y los bordes del mes. ----

describe('Gastos por día del calendario (#219)', () => {
	it('suma el total de cada día exacto y deja fuera lo ajeno al mes', async () => {
		const familyId = await familyRow('Familia Diario');
		// Dos compras del día 1, sembradas de vieja a nueva: dentro del día se
		// esperan de la más reciente a la más antigua (el orden del historial).
		const vieja = await purchaseRow(familyId, {
			listName: 'Compras del día 1, vieja',
			total: 10.5,
			createdAt: new Date('2026-06-01T10:00:00Z')
		});
		const nueva = await purchaseRow(familyId, {
			listName: 'Compras del día 1, nueva',
			total: 20.25,
			createdAt: new Date('2026-06-01T18:00:00Z')
		});
		await purchaseRow(familyId, {
			// 0.1 + 0.2 en flotantes sería 0.30000000000000004: el total del día
			// ha de dar 0.3 exactos porque la suma va en céntimos.
			listName: 'Céntimos a',
			total: 0.1,
			createdAt: new Date('2026-06-15T09:00:00Z')
		});
		await purchaseRow(familyId, {
			listName: 'Céntimos b',
			total: 0.2,
			createdAt: new Date('2026-06-15T20:00:00Z')
		});
		await purchaseRow(familyId, {
			listName: 'Última del mes',
			total: 0.75,
			createdAt: new Date('2026-06-30T21:30:00Z') // 23:30 CEST del día 30
		});
		// Fuera por arriba: las 02:30 CEST del 1 de julio.
		await purchaseRow(familyId, {
			listName: 'Ya en julio',
			total: 99,
			createdAt: new Date('2026-07-01T00:30:00Z')
		});
		// Fuera por abajo: las 23:00 CEST del 30 de mayo.
		await purchaseRow(familyId, {
			listName: 'Aún en mayo',
			total: 88,
			createdAt: new Date('2026-05-30T21:00:00Z')
		});

		const byDay = await listPurchasesByDay(familyId, '2026-06');

		// Solo los días con compras, con su clave de celda del grid.
		expect(Object.keys(byDay).sort()).toEqual(['2026-06-01', '2026-06-15', '2026-06-30']);
		expect(byDay['2026-06-01'].total).toBe(30.75);
		expect(byDay['2026-06-15'].total).toBe(0.3);
		expect(byDay['2026-06-30'].total).toBe(0.75);
		// Dentro del día, la más reciente primero (orden del historial) y cada
		// compra con su total propio.
		expect(byDay['2026-06-01'].purchases.map((purchase) => purchase.id)).toEqual([
			nueva.id,
			vieja.id
		]);
		expect(byDay['2026-06-01'].purchases.map((purchase) => purchase.total)).toEqual([20.25, 10.5]);
		// El total del mes sale de la suma de los días (#219): con céntimos
		// detrás da lo que debe (la última paja de flotante la junta la
		// presentación, no la agregación).
		const monthTotal = Object.values(byDay).reduce((sum, day) => sum + day.total, 0);
		expect(monthTotal).toBeCloseTo(31.8, 10);
	});

	it('una compra de las 00:30 hora española cuenta en SU día, con y sin horario de verano', async () => {
		const familyId = await familyRow('Familia Madrugadora');
		// 22:30 UTC del 31 de mayo son las 00:30 CEST del 1 de junio (UTC+2):
		// el día español manda aunque el UTC aún esté en mayo.
		const verano = await purchaseRow(familyId, {
			listName: 'Madrugona de verano',
			total: 7,
			createdAt: new Date('2026-05-31T22:30:00Z')
		});
		// 23:30 UTC del 31 de octubre son las 00:30 CET del 1 de noviembre
		// (UTC+1, ya sin horario de verano): el mismo caso en el otro tramo
		// del DST — no hay offset hardcodeado que valga para los dos.
		const invierno = await purchaseRow(familyId, {
			listName: 'Madrugona de invierno',
			total: 8,
			createdAt: new Date('2026-10-31T23:30:00Z')
		});

		const junio = await listPurchasesByDay(familyId, '2026-06');
		expect(Object.keys(junio)).toEqual(['2026-06-01']);
		expect(junio['2026-06-01'].purchases.map((purchase) => purchase.id)).toEqual([verano.id]);

		const noviembre = await listPurchasesByDay(familyId, '2026-11');
		expect(Object.keys(noviembre)).toEqual(['2026-11-01']);
		expect(noviembre['2026-11-01'].purchases.map((purchase) => purchase.id)).toEqual([invierno.id]);

		// El UTC de la víspera no las coló en mayo ni en octubre.
		expect(await listPurchasesByDay(familyId, '2026-05')).toEqual({});
		expect(await listPurchasesByDay(familyId, '2026-10')).toEqual({});
	});

	it('el detalle lleva el establecimiento vivo, o el del snapshot si la tienda se borró', async () => {
		const familyId = await familyRow('Familia Tiendas Diario');
		const mercadona = await createStore(familyId, { name: 'Mercadona' });
		const muerta = await createStore(familyId, { name: 'Chino' });
		await purchaseRow(familyId, {
			listName: 'En tienda viva',
			total: 3,
			createdAt: new Date('2026-06-02T10:00:00Z'),
			storeId: mercadona.id,
			storeName: mercadona.name
		});
		await purchaseRow(familyId, {
			listName: 'En tienda que morirá',
			total: 4,
			createdAt: new Date('2026-06-02T11:00:00Z'),
			storeId: muerta.id,
			storeName: muerta.name
		});
		await purchaseRow(familyId, {
			listName: 'Sin tienda',
			total: 5,
			createdAt: new Date('2026-06-03T10:00:00Z')
		});

		// Renombrar la viva y borrar la otra: el día muestra el nombre ACTUAL
		// de la primera (no el del snapshot) y el CONGELADO de la segunda,
		// como titula las secciones el historial (#187).
		await prisma.store.update({ where: { id: mercadona.id }, data: { name: 'Mercadona SA' } });
		await prisma.store.delete({ where: { id: muerta.id } });

		const byDay = await listPurchasesByDay(familyId, '2026-06');
		expect(byDay['2026-06-02'].purchases.map((purchase) => purchase.storeName)).toEqual([
			'Chino',
			'Mercadona SA'
		]);
		expect(byDay['2026-06-03'].purchases.map((purchase) => purchase.storeName)).toEqual([null]);
	});

	it('la familia pedida solo ve SUS compras: las ajenas no aparecen ni suman', async () => {
		const familyId = await familyRow('Familia Diario Propia');
		const otherFamily = await familyRow('Familia Diario Ajena');
		const ajena = await purchaseRow(otherFamily, {
			listName: 'Caviar ajeno',
			total: 99,
			createdAt: new Date('2026-06-05T10:00:00Z')
		});
		const propia = await purchaseRow(familyId, {
			listName: 'Compra propia',
			total: 6,
			createdAt: new Date('2026-06-05T11:00:00Z')
		});

		const byDay = await listPurchasesByDay(familyId, '2026-06');
		expect(Object.keys(byDay)).toEqual(['2026-06-05']);
		expect(byDay['2026-06-05'].purchases.map((purchase) => purchase.id)).toEqual([propia.id]);
		expect(byDay['2026-06-05'].total).toBe(6);

		// A la ajena solo le sale lo suyo, también ese mismo día.
		const ajenaByDay = await listPurchasesByDay(otherFamily, '2026-06');
		expect(ajenaByDay['2026-06-05'].purchases.map((purchase) => purchase.id)).toEqual([ajena.id]);
		expect(ajenaByDay['2026-06-05'].total).toBe(99);

		// Una familia sin compras ese mes no tiene días que pintar.
		expect(await listPurchasesByDay(familyId, '2026-07')).toEqual({});
	});
});
