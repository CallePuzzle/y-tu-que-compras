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
const LISTA = { name: 'Compra semanal', color: 'yellow', icon: 'shopping-basket' } as const;

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
		const list = await createList(familyId, LISTA);
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
		const restantes = await prisma.item.findMany({ where: { listId: list.id } });
		expect(restantes.map((row) => row.id)).toEqual([huevos.id]);
		expect((await prisma.item.findUnique({ where: { id: huevos.id } }))?.purchased).toBe(false);

		// Los comprados ya no están.
		expect(await prisma.item.findMany({ where: { id: { in: [pan.id, leche.id] } } })).toHaveLength(
			0
		);

		// Historial (#75): snapshot de la lista y de los items, total a mano y
		// quién finalizó.
		const purchase = await purchaseWithItems(familyId);
		expect(purchase.listId).toBe(list.id);
		expect(purchase.listName).toBe(LISTA.name);
		expect(Number(purchase.total)).toBe(42.67);
		expect(purchase.userId).toBe(userId);
		expect(purchase.items.map((row) => [row.name, Number(row.quantity), row.unit])).toEqual([
			['Leche entera', 1.5, 'liter'],
			['Pan', 1, 'unit']
		]);
	});

	it('suma cantidades cuando el producto ya estaba en la despensa (mismo canónico y unidad), y separa por unidad', async () => {
		const familyId = await familyRow('Familia Repetidora');
		const list = await createList(familyId, LISTA);

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
		const litros = pantry.find((row) => row.unit === 'liter');
		const gramos = pantry.find((row) => row.unit === 'gram');
		expect(Number(litros?.quantity)).toBe(1.75);
		// El nombre visible lo puso la primera vez: no lo machaca la compra.
		expect(litros?.name).toBe('Leche Entera');
		expect(Number(gramos?.quantity)).toBe(250);
	});

	it('dos comprados con el mismo canónico en la MISMA lista aterrizan sumados en un solo row', async () => {
		const familyId = await familyRow('Familia Duplicada');
		const list = await createList(familyId, LISTA);
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
		const list = await createList(familyId, LISTA);
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
		const list = await createList(familyId, LISTA);
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
		const mia = await familyRow('Familia Curiosa');
		const ajena = await familyRow('Familia Intacta');
		const externa = await createList(ajena, LISTA);
		const ajeno = await createItemOrFail(ajena, externa.id, ITEM, true);

		expect(await finalizePurchase(mia, externa.id, 5, await userRow('Curioso'))).toBe('list-gone');

		// La compra de la familia ajena sigue exactamente igual.
		expect(await prisma.item.findUnique({ where: { id: ajeno.id } })).not.toBeNull();
		expect(await prisma.purchaseRecord.findMany({ where: { organizationId: ajena } })).toHaveLength(
			0
		);
		expect(await prisma.pantryItem.findMany({ where: { organizationId: mia } })).toHaveLength(0);
	});

	it('finalizar dos veces seguidas no duplica: la segunda es `nothing-purchased`', async () => {
		const familyId = await familyRow('Familia Repetida');
		const list = await createList(familyId, LISTA);
		await createItemOrFail(familyId, list.id, { ...ITEM, quantity: 2 }, true);

		const primero = await userRow('Primero');
		const segundo = await userRow('Segundo');
		expect(await finalizePurchase(familyId, list.id, 10, primero)).toBe('finalized');
		// Doble click: la segunda pasada ya no encuentra comprados.
		expect(await finalizePurchase(familyId, list.id, 10, segundo)).toBe('nothing-purchased');

		expect(
			await prisma.purchaseRecord.findMany({ where: { organizationId: familyId } })
		).toHaveLength(1);
		const pantry = await prisma.pantryItem.findMany({ where: { organizationId: familyId } });
		expect(pantry).toHaveLength(1);
		expect(Number(pantry[0].quantity)).toBe(2);
	});

	it('dos miembros que finalizan A LA VEZ: exactamente uno gana y la despensa suma una vez', async () => {
		const familyId = await familyRow('Familia a la Vez');
		const list = await createList(familyId, LISTA);
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
		const primera = await createList(familyId, LISTA);
		const segunda = await createList(familyId, { ...LISTA, name: 'Compra cruzada' });
		await createItemOrFail(familyId, primera.id, { ...ITEM, quantity: 1.5 }, true);
		await createItemOrFail(familyId, primera.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);
		await createItemOrFail(familyId, segunda.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);
		await createItemOrFail(familyId, segunda.id, { ...ITEM, quantity: 1 }, true);

		const outcomes = await Promise.all([
			finalizePurchase(familyId, primera.id, 10, await userRow('Comprador Uno')),
			finalizePurchase(familyId, segunda.id, 12, await userRow('Comprador Dos'))
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
		const list = await createList(familyId, LISTA);
		const lacteos = await categoryRow(familyId, 'Lácteos');
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Yogur', quantity: 4, unit: 'unit', categoryId: lacteos.id },
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
			['Yogur', lacteos.id]
		]);
	});

	it('el producto que YA tenía categoría la conserva aunque la compra traiga otra, y suma', async () => {
		const familyId = await familyRow('Familia Fiel');
		const list = await createList(familyId, LISTA);
		const vieja = await categoryRow(familyId, 'Desayuno');
		const nueva = await categoryRow(familyId, 'Lácteos', 1);
		await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Leche Entera',
				normalizedName: normalizeItemName('Leche Entera'),
				quantity: 1,
				unit: 'liter',
				categoryId: vieja.id
			}
		});
		// El item trae OTRA categoría (Lácteos): recategorizar no es cosa de
		// la compra — gana la existente del producto.
		await createItemOrFail(familyId, list.id, { ...ITEM, categoryId: nueva.id }, true);

		expect(await finalizePurchase(familyId, list.id, 3, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const leche = await prisma.pantryItem.findFirstOrThrow({
			where: { organizationId: familyId, normalizedName: 'leche entera' }
		});
		expect(leche.categoryId).toBe(vieja.id);
		expect(leche.name).toBe('Leche Entera');
		expect(Number(leche.quantity)).toBe(3);
	});

	it('el producto SIN categoría hereda la de la compra, sin tocar nombre ni cantidad previa', async () => {
		const familyId = await familyRow('Familia Huérfana');
		const list = await createList(familyId, LISTA);
		const lacteos = await categoryRow(familyId, 'Lácteos');
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
			{ name: 'Yogur', quantity: 4, unit: 'unit', categoryId: lacteos.id },
			true
		);

		expect(await finalizePurchase(familyId, list.id, 4, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const yogur = await prisma.pantryItem.findFirstOrThrow({
			where: { organizationId: familyId, normalizedName: 'yogur' }
		});
		expect(yogur.categoryId).toBe(lacteos.id);
		expect(yogur.name).toBe('Yogur');
		expect(Number(yogur.quantity)).toBe(6);
	});

	it('la compra sin categorías no descategoriza lo que ya tenía', async () => {
		const familyId = await familyRow('Familia Sin Categorías');
		const list = await createList(familyId, LISTA);
		const lacteos = await categoryRow(familyId, 'Lácteos');
		await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Yogur',
				normalizedName: 'yogur',
				quantity: 1,
				unit: 'unit',
				categoryId: lacteos.id
			}
		});
		await createItemOrFail(familyId, list.id, { name: 'Yogur', quantity: 2, unit: 'unit' }, true);

		expect(await finalizePurchase(familyId, list.id, 2, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const yogur = await prisma.pantryItem.findFirstOrThrow({
			where: { organizationId: familyId, normalizedName: 'yogur' }
		});
		expect(yogur.categoryId).toBe(lacteos.id);
		expect(Number(yogur.quantity)).toBe(3);
	});

	it('dos comprados del MISMO producto con categorías distintas: gana la primera del orden canónico', async () => {
		const familyId = await familyRow('Familia Dúplex');
		const list = await createList(familyId, LISTA);
		const primera = await categoryRow(familyId, 'Lácteos');
		const segunda = await categoryRow(familyId, 'Desayuno', 1);
		// Mismo producto (canónico y unidad) en dos filas con categorías
		// distintas: aterrizan juntos en UN producto y la categoría la fija
		// el primero del orden — los gemelos de producto empatan en el
		// canónico, así que manda el primero de la lista.
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Leche entera', quantity: 1, unit: 'liter', categoryId: primera.id },
			true
		);
		await createItemOrFail(
			familyId,
			list.id,
			{ name: 'leche entera', quantity: 1, unit: 'liter', categoryId: segunda.id },
			true
		);

		expect(await finalizePurchase(familyId, list.id, 2, await userRow('Comprador'))).toBe(
			'finalized'
		);

		const pantry = await prisma.pantryItem.findMany({ where: { organizationId: familyId } });
		expect(pantry).toHaveLength(1);
		expect(pantry[0].categoryId).toBe(primera.id);
		expect(Number(pantry[0].quantity)).toBe(2);
	});

	it('el snapshot del historial congela la categoría por id y por nombre, fiel a lo comprado', async () => {
		const familyId = await familyRow('Familia Congelada');
		const list = await createList(familyId, LISTA);
		const lacteos = await categoryRow(familyId, 'Lácteos');
		await createItemOrFail(familyId, list.id, { ...ITEM, categoryId: lacteos.id }, true);
		await createItemOrFail(familyId, list.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);

		expect(await finalizePurchase(familyId, list.id, 4, await userRow('Comprador'))).toBe(
			'finalized'
		);

		// El snapshot guarda la categoría del momento: id y nombre visible,
		// como el `listName` congela el de la lista.
		const compra = await purchaseWithItems(familyId);
		const [leche, pan] = compra.items;
		expect(leche).toMatchObject({
			name: 'Leche entera',
			categoryId: lacteos.id,
			categoryName: 'Lácteos'
		});
		expect(pan).toMatchObject({ name: 'Pan', categoryId: null, categoryName: null });

		// Fiel a lo comprado aunque el presente cambie: recategorizar el
		// producto de la despensa DESPUÉS no retoca el historial (el SetNull
		// del borrado de categorías lo ejercita `categories.int.spec.ts`).
		const producto = await prisma.pantryItem.findFirstOrThrow({
			where: { organizationId: familyId, normalizedName: 'leche entera' }
		});
		const desayuno = await categoryRow(familyId, 'Desayuno', 1);
		await prisma.pantryItem.update({
			where: { id: producto.id },
			data: { categoryId: desayuno.id }
		});
		const despues = await purchaseWithItems(familyId);
		expect(despues.items[0]).toMatchObject({
			name: 'Leche entera',
			categoryId: lacteos.id,
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
		const list = await createList(familyId, LISTA);
		const mercadona = await createStore(familyId, { name: 'Mercadona' });
		await createItemOrFail(familyId, list.id, { ...ITEM, quantity: 1.5 }, true);

		expect(
			await finalizePurchase(familyId, list.id, 12.3, await userRow('Comprador'), mercadona.id)
		).toBe('finalized');

		// El snapshot guarda la tienda DEL MOMENTO: id para la FK y nombre
		// visible congelado, como el `listName` congela el de la lista.
		const compra = await purchaseWithItems(familyId);
		expect(compra).toMatchObject({ storeId: mercadona.id, storeName: 'Mercadona' });

		// Renombrarla después no retoca el historial; borrarla le quita el id
		// (SetNull) pero el nombre congelado sobrevive en el ticket.
		await prisma.store.update({ where: { id: mercadona.id }, data: { name: 'Mercadona SA' } });
		await prisma.store.delete({ where: { id: mercadona.id } });
		const despues = await purchaseWithItems(familyId);
		expect(despues).toMatchObject({ storeId: null, storeName: 'Mercadona' });
	});

	it('la compra sin establecimiento no lleva ni id ni nombre', async () => {
		const familyId = await familyRow('Familia Anónima');
		const list = await createList(familyId, LISTA);
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
		const list = await createList(familyId, LISTA);
		const pan = await createItemOrFail(
			familyId,
			list.id,
			{ name: 'Pan', quantity: 1, unit: 'unit' },
			true
		);

		// Rancio: la tienda existió y la borraron mientras se rellenaba el modal.
		const efimera = await createStore(familyId, { name: 'Chino de antes' });
		await prisma.store.delete({ where: { id: efimera.id } });
		expect(
			await finalizePurchase(familyId, list.id, 5, await userRow('Comprador'), efimera.id)
		).toBe('store-gone');

		// Ajeno: un id de OTRA familia es igual de «no existe aquí».
		const ajena = await familyRow('Familia Tendera');
		const ajeno = await createStore(ajena, { name: 'Mercadona ajeno' });
		expect(await finalizePurchase(familyId, list.id, 5, await userRow('Comprador'), ajeno.id)).toBe(
			'store-gone'
		);

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
		const ajena = await familyRow('Familia Agrupada Ajena');
		await purchaseRow(ajena, {
			listName: 'Caviar ajeno',
			total: 99,
			createdAt: new Date('2026-06-16T10:00:00Z')
		});

		const { groups } = await listPurchasesByStore(familyId);

		// Secciones por su compra más reciente: Lidl (15 jun) sobre Mercadona
		// (10 jun), y «Sin establecimiento» al final aunque su compra sea la
		// más nueva. La clave de una sección viva es el id de la tienda; su
		// título, el nombre visible.
		expect(groups.map((grupo) => [grupo.key, grupo.storeName])).toEqual([
			[lidl.id, 'Lidl'],
			[mercadona.id, 'Mercadona'],
			['none', null]
		]);
		// Dentro de cada sección, de la más reciente a la más antigua.
		expect(groups.map((grupo) => grupo.purchases.map((row) => row.listName))).toEqual([
			['Compra Lidl'],
			['Compra Mercadona nueva', 'Compra Mercadona vieja'],
			['Compra suelta nueva', 'Compra suelta vieja']
		]);
		// Ni historia detrás ni offset pedido en la primera página.
		expect(groups.map((grupo) => [grupo.offset, grupo.hasMore])).toEqual([
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

		const primera = await listPurchasesByStore(familyId);
		const suMercadona = primera.groups.find((grupo) => grupo.key === mercadona.id);
		expect(suMercadona?.purchases).toHaveLength(PURCHASES_PAGE_SIZE);
		expect(suMercadona?.hasMore).toBe(true);
		// La más nueva primero: la última sembrada.
		expect(suMercadona?.purchases[0].listName).toBe(`Compra Mercadona ${total}`);
		// La sección del Lidl, completa e intacta.
		expect(primera.groups.find((grupo) => grupo.key === lidl.id)?.purchases).toHaveLength(1);

		// La «segunda página» de Mercadona trae TODO lo suyo, no solo sus 5
		// filas: es lo que hace que «Cargar más» añada al final de lo pintado.
		// El offset de Lidl no viaja: su sección se sirve entera igual.
		const crecida = await listPurchasesByStore(familyId, { [mercadona.id]: PURCHASES_PAGE_SIZE });
		const mercadonaCrecida = crecida.groups.find((grupo) => grupo.key === mercadona.id);
		expect(mercadonaCrecida?.purchases).toHaveLength(total);
		expect(mercadonaCrecida?.hasMore).toBe(false);
		// Las filas ya vistas no cambian de sitio ni de contenido.
		expect(mercadonaCrecida?.purchases.slice(0, PURCHASES_PAGE_SIZE)).toEqual(
			suMercadona?.purchases
		);
		expect(crecida.groups.find((grupo) => grupo.key === lidl.id)?.purchases).toHaveLength(1);
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
		expect(basura.groups.find((grupo) => grupo.key === mercadona.id)?.purchases).toHaveLength(1);
		const negativo = await listPurchasesByStore(familyId, { [mercadona.id]: -5 });
		expect(negativo.groups.find((grupo) => grupo.key === mercadona.id)?.purchases).toHaveLength(1);

		// Sin acotar, `1e21` pasaba Number.isInteger y el `take` desmedido
		// reventaba Prisma (500); un millón volcaba la sección entera. El tope
		// es POR BLOQUE: cada sección acota el suyo, sea de tienda o el final.
		const acotado = await listPurchasesByStore(familyId, { [mercadona.id]: 1e21 });
		expect(() => listPurchasesByStore(familyId, { [mercadona.id]: 1e21 })).not.toThrow();
		const suBloque = acotado.groups.find((grupo) => grupo.key === mercadona.id);
		expect(suBloque?.purchases).toHaveLength(1);
		expect(suBloque?.offset).toBe(MAX_PURCHASES_OFFSET);
		expect(
			(await listPurchasesByStore(familyId, { [mercadona.id]: 1_000_000 })).groups.find(
				(grupo) => grupo.key === mercadona.id
			)
		).toEqual(suBloque);
		expect(
			(await listPurchasesByStore(familyId, { [mercadona.id]: MAX_PURCHASES_OFFSET })).groups.find(
				(grupo) => grupo.key === mercadona.id
			)
		).toEqual(suBloque);

		// El bloque de «Sin establecimiento» acota el suyo con la misma regla.
		const { groups } = await listPurchasesByStore(familyId);
		const sinBloque = groups.find((grupo) => grupo.storeName === null);
		expect(sinBloque).toBeDefined();
		const acotadoSin = await listPurchasesByStore(familyId, { [sinBloque!.key]: 1e21 });
		expect(acotadoSin.groups.find((grupo) => grupo.storeName === null)?.offset).toBe(
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
		expect(groups.map((grupo) => [grupo.key, grupo.storeName])).toEqual([
			[`nombre:${mercadona.name}`, 'Mercadona'],
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
		const lista = await createList(familyId, LISTA);
		const compra = await purchaseRow(familyId, {
			listId: lista.id,
			listName: LISTA.name,
			total: 5,
			createdAt: new Date('2026-06-01T10:00:00Z'),
			items: [
				{ name: 'Pan', quantity: 1, unit: 'unit' },
				{ name: 'Leche entera', quantity: 1.5, unit: 'liter' }
			]
		});

		const detalle = await getPurchase(familyId, compra.id);
		expect(detalle?.items.map((item) => item.name)).toEqual(['Pan', 'Leche entera']);
	});

	it('el detalle lleva el establecimiento del snapshot (#187) y sobrevive a que se borre', async () => {
		const familyId = await familyRow('Familia Ticket Establecido');
		const mercadona = await createStore(familyId, { name: 'Mercadona' });
		const compra = await purchaseRow(familyId, {
			listName: 'Compra con tienda',
			total: 20,
			createdAt: new Date('2026-06-10T10:00:00Z'),
			storeId: mercadona.id,
			storeName: mercadona.name
		});
		const suelta = await purchaseRow(familyId, {
			listName: 'Compra sin tienda',
			total: 5,
			createdAt: new Date('2026-06-11T10:00:00Z')
		});

		expect((await getPurchase(familyId, compra.id))?.storeName).toBe('Mercadona');
		expect((await getPurchase(familyId, suelta.id))?.storeName).toBeNull();

		// Fiel a lo comprado aunque el presente cambie: renombrar la tienda y
		// borrarla (SetNull) no retoca el ticket — el nombre congelado queda.
		await prisma.store.update({ where: { id: mercadona.id }, data: { name: 'Mercadona SA' } });
		await prisma.store.delete({ where: { id: mercadona.id } });
		expect((await getPurchase(familyId, compra.id))?.storeName).toBe('Mercadona');
	});

	it('devuelve el snapshot completo: items congelados, total a mano y nombre de lista guardado', async () => {
		const familyId = await familyRow('Familia Detallada');
		const lista = await createList(familyId, LISTA);
		const compra = await purchaseRow(familyId, {
			listId: lista.id,
			listName: LISTA.name,
			total: 42.67,
			createdAt: new Date('2026-06-01T10:00:00Z'),
			items: [
				{ name: 'Leche entera', quantity: 1.5, unit: 'liter' },
				{ name: 'Pan', quantity: 1, unit: 'unit' }
			]
		});

		const detalle = await getPurchase(familyId, compra.id);
		expect(detalle?.listName).toBe(LISTA.name);
		expect(detalle?.total).toBe(42.67);
		expect(detalle?.items.map((item) => [item.name, item.quantity, item.unit])).toEqual([
			['Leche entera', 1.5, 'liter'],
			['Pan', 1, 'unit']
		]);

		// El snapshot no le afecta el presente (#33): renombrar la lista de
		// origen y añadirle items no altera el detalle de la compra.
		await prisma.list.update({ where: { id: lista.id }, data: { name: 'Renombrada' } });
		await createItem(familyId, lista.id, { name: 'Nuevo', quantity: 1, unit: 'unit' });
		const despues = await getPurchase(familyId, compra.id);
		expect(despues?.listName).toBe(LISTA.name);
		expect(despues?.items).toHaveLength(2);
	});

	it('la compra de otra familia es como si no existiera', async () => {
		const familyId = await familyRow('Familia Detalle Propia');
		const ajena = await familyRow('Familia Detalle Ajena');
		const compra = await purchaseRow(ajena, {
			listName: 'Ajena',
			total: 5,
			createdAt: new Date('2026-06-01T10:00:00Z')
		});

		expect(await getPurchase(familyId, compra.id)).toBeNull();
		// Un id inventado tampoco: sin revelar si vive en otra parte.
		expect(await getPurchase(familyId, 'no-existe')).toBeNull();
	});
});
