import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): `finalizePurchase` contra
// un Postgres real con las migraciones aplicadas. Como en `items.int.spec.ts`
// no hacen falta sesiones: las familias, listas e items de prueba se crean
// directamente con Prisma y lo que se ejercita es la transacción de finalizar
// compra (issue #70): despensa, historial (#75) y lista depurada, todo a la vez
// — y la protección contra la doble finalización.
import type { ItemData } from '$lib/schemas/item.js';
import prisma from './prisma.js';
import { createItem, setItemPurchased } from './items.js';
import { createList } from './lists.js';
import {
	finalizePurchase,
	getPurchase,
	listPurchases,
	MAX_PURCHASES_OFFSET,
	normalizeItemName,
	PURCHASES_PAGE_SIZE
} from './purchases.js';

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
const LISTA = { name: 'Compra semanal', color: 'primary', icon: 'shopping-basket' } as const;

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
		// El orden (#134): los NUEVOS aterrizan por el final (max + 1), en el
		// orden canónico del bucle de upserts (leche antes que pan). Es el
		// mismo arranque que `createItem`: el primero de una despensa vacía
		// empieza por 0.
		expect(pantry.map((row) => row.order)).toEqual([0, 1]);

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

	it('los NUEVOS entran por el final de la despensa sin tocar el orden de los que ya estaban (#134)', async () => {
		const familyId = await familyRow('Familia Con Orden');
		const list = await createList(familyId, LISTA);
		// La despensa ya tiene producto con SU orden (la dejó un reorden): la
		// leche no se mueve cuando aterrice la compra, solo suma cantidad.
		await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Leche entera',
				normalizedName: 'leche entera',
				quantity: 1,
				unit: 'liter',
				order: 1
			}
		});
		await createItemOrFail(familyId, list.id, { ...ITEM, quantity: 1 }, true);
		await createItemOrFail(familyId, list.id, { name: 'Pan', quantity: 1, unit: 'unit' }, true);

		const userId = await userRow('Quien Finaliza');
		expect(await finalizePurchase(familyId, list.id, 10, userId)).toBe('finalized');

		// El existente conserva su orden; el nuevo aterriza detrás (max + 1).
		const pantry = await prisma.pantryItem.findMany({
			where: { organizationId: familyId },
			orderBy: { order: 'asc' }
		});
		expect(pantry.map((row) => [row.name, row.order])).toEqual([
			['Leche entera', 1],
			['Pan', 2]
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
				unit: 'liter',
				order: 1
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
				unit: 'unit',
				order: 1
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

// ---- Historial (issues #47 y #76): la consulta del snapshot que deja
// `finalizePurchase`. Las compras de prueba se siembran a mano con
// `createdAt` explícitos: es el único modo de controlar el orden y la
// paginación sin depender del reloj. ----

/** Siembra una compra con su snapshot, como la deja `finalizePurchase`. */
async function purchaseRow(
	familyId: string,
	options: {
		listName: string;
		total: number;
		createdAt: Date;
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

describe('Historial: listado de la familia (#76)', () => {
	it('lista las compras de la más reciente a la más antigua, y solo las de ESA familia', async () => {
		const familyId = await familyRow('Familia Historiada');
		const vieja = await purchaseRow(familyId, {
			listName: 'Compra vieja',
			total: 10,
			createdAt: new Date('2026-01-01T10:00:00Z')
		});
		const nueva = await purchaseRow(familyId, {
			listName: 'Compra reciente',
			total: 20,
			createdAt: new Date('2026-06-01T10:00:00Z')
		});

		// El historial es por familia (criterio de la #33): la compra de otra
		// no aparece, como si no existiera.
		const ajena = await familyRow('Familia Historiada Ajena');
		await purchaseRow(ajena, {
			listName: 'Caviar ajeno',
			total: 99,
			createdAt: new Date('2026-06-02T10:00:00Z')
		});

		const { purchases, hasMore } = await listPurchases(familyId, 0);
		expect(purchases.map((row) => row.id)).toEqual([nueva.id, vieja.id]);
		expect(hasMore).toBe(false);
		// La vista aplana el Decimal del total y conserva el nombre de lista
		// del snapshot.
		expect(purchases[1]).toMatchObject({ listName: 'Compra vieja', total: 10 });
	});

	it('pagina de forma ACUMULATIVA: la página de un offset incluye todo lo anterior y avisa si queda más', async () => {
		const familyId = await familyRow('Familia Paginada');
		const total = PURCHASES_PAGE_SIZE + 5;
		for (let i = 0; i < total; i++) {
			// createdAt crecientes: la compra i+1 es la más nueva de las i+1.
			await purchaseRow(familyId, {
				listName: `Compra ${i + 1}`,
				total: i,
				createdAt: new Date(Date.UTC(2026, 0, 1, 0, i))
			});
		}

		const primera = await listPurchases(familyId, 0);
		expect(primera.purchases).toHaveLength(PURCHASES_PAGE_SIZE);
		expect(primera.hasMore).toBe(true);
		// La más nueva primero: la última sembrada.
		expect(primera.purchases[0].listName).toBe(`Compra ${total}`);

		// La «segunda página» trae TODO el historial, no solo sus 5 filas: es
		// lo que hace que «Cargar más» añada al final de lo ya pintado.
		const crecida = await listPurchases(familyId, PURCHASES_PAGE_SIZE);
		expect(crecida.purchases).toHaveLength(total);
		expect(crecida.hasMore).toBe(false);
		// Las filas ya vistas no cambian de sitio ni de contenido.
		expect(crecida.purchases.slice(0, PURCHASES_PAGE_SIZE)).toEqual(primera.purchases);
	});

	it('un offset basura o negativo es la primera página, y uno desmedido se acota (#109)', async () => {
		const familyId = await familyRow('Familia Offset Basura');
		await purchaseRow(familyId, {
			listName: 'Única',
			total: 1,
			createdAt: new Date('2026-03-01T10:00:00Z')
		});

		const basura = await listPurchases(familyId, Number.NaN);
		expect(basura.purchases).toHaveLength(1);
		expect(basura.hasMore).toBe(false);
		const negativo = await listPurchases(familyId, -5);
		expect(negativo.purchases).toHaveLength(1);

		// Sin acotar, `1e21` pasaba Number.isInteger y el `take` desmedido
		// reventaba Prisma (500); un millón volcaba el historial entero.
		expect(() => listPurchases(familyId, 1e21)).not.toThrow();
		const acotado = await listPurchases(familyId, 1e21);
		expect(acotado.purchases).toHaveLength(1);
		expect(await listPurchases(familyId, 1_000_000)).toEqual(acotado);
		expect(await listPurchases(familyId, MAX_PURCHASES_OFFSET)).toEqual(acotado);
	});

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
});

describe('Historial: detalle de una compra (#76)', () => {
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
