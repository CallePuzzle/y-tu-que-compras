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
import { finalizePurchase, normalizeItemName } from './purchases.js';

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

		// Dos peticiones concurrentes (doble click, dos miembros): el reclamo
		// atómico deja pasar a una y revierte a la otra SIN rastro.
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
});
