import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): `listPantryItems`
// (`#lib/server/pantry.ts`) contra un Postgres real con las migraciones
// aplicadas. Como en `lists.int.spec.ts`, las familias de prueba se crean
// directamente con Prisma (las filas de despensa solo cuelgan de la
// organización por FK, el plugin de tenancy no entra en el camino) y lo que se
// ejercita es la consulta con el filtro de familia — el criterio de la #44:
// la despensa muestra SOLO los productos de la familia activa, con la cantidad
// Decimal aplanada a número para la vista (#72).
import prisma from './prisma.js';
import {
	adjustPantryItem,
	listPantryItems,
	removePantryItem,
	readdPantryItem,
	setPantryItemCategory,
	updatePantryItem
} from './pantry.js';
import { createCategory, deleteCategory } from './categories.js';
import { createItem } from './items.js';
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

/** Siembra un producto de despensa con los datos dados (lo que deja `finalizePurchase`). */ function pantryRow(
	familyId: string,
	name: string,
	quantity: number,
	unit: Parameters<typeof prisma.pantryItem.create>[0]['data']['unit']
) {
	return prisma.pantryItem.create({
		data: {
			organizationId: familyId,
			name,
			normalizedName: name
				.trim()
				.normalize('NFD')
				.replace(/\p{Diacritic}/gu, '')
				.toLowerCase(),
			quantity,
			unit
		}
	});
}

describe('Consulta de despensa por familia (#72)', () => {
	it('listPantryItems devuelve los productos de la familia con la cantidad aplanada', async () => {
		const familyId = await familyRow('Familia Despensa');
		await pantryRow(familyId, 'Leche entera', 1.5, 'liter');
		await pantryRow(familyId, 'Pan', 1, 'unit');

		const items = await listPantryItems(familyId);
		expect(items).toHaveLength(2);
		// La cantidad viaja como `number` (el Decimal de la base, aplanado) y
		// la unidad como el identificador del enum, que la UI traduce.
		expect(items).toMatchObject([
			{ name: 'Leche entera', quantity: 1.5, unit: 'liter' },
			{ name: 'Pan', quantity: 1, unit: 'unit' }
		]);
	});

	it('los productos de otras familias no se ven', async () => {
		const ownFamily = await familyRow('Familia Propia');
		const otherFamily = await familyRow('Familia Ajena');
		await pantryRow(ownFamily, 'Leche entera', 1, 'liter');
		await pantryRow(otherFamily, 'Caviar', 1, 'unit');

		const items = await listPantryItems(ownFamily);
		expect(items.map((item) => item.name)).toEqual(['Leche entera']);
	});

	it('orden alfabético por nombre visible', async () => {
		const familyId = await familyRow('Familia Ordenada');
		await pantryRow(familyId, 'Tomate', 1, 'kilogram');
		await pantryRow(familyId, 'Arroz', 1, 'package');
		await pantryRow(familyId, 'Leche', 1, 'liter');

		const items = await listPantryItems(familyId);
		expect(items.map((item) => item.name)).toEqual(['Arroz', 'Leche', 'Tomate']);
	});

	it('una familia sin despensa devuelve una lista vacía', async () => {
		const familyId = await familyRow('Familia Vacía');
		await expect(listPantryItems(familyId)).resolves.toEqual([]);
	});
});

/** Lee la cantidad guardada de un producto (el Decimal aplanado), o null si ya no está. */
async function quantityOf(id: string): Promise<number | null> {
	const row = await prisma.pantryItem.findUnique({ where: { id }, select: { quantity: true } });
	return row ? Number(row.quantity) : null;
}

describe('Consumir y devolver un paso (#73)', () => {
	it('consume (−) el paso de la unidad guardada: ud = 1, kg = 0,25, g = 100', async () => {
		const familyId = await familyRow('Familia Consumidora');
		const pan = await pantryRow(familyId, 'Pan', 2, 'unit');
		const leche = await pantryRow(familyId, 'Leche entera', 0.5, 'kilogram');
		const arroz = await pantryRow(familyId, 'Arroz', 500, 'gram');

		await expect(adjustPantryItem(familyId, pan.id, -1)).resolves.toBe(true);
		await expect(adjustPantryItem(familyId, leche.id, -1)).resolves.toBe(true);
		await expect(adjustPantryItem(familyId, arroz.id, -1)).resolves.toBe(true);

		// El paso lo fija el servidor según la unidad: cada producto baja lo suyo.
		await expect(quantityOf(pan.id)).resolves.toBe(1);
		await expect(quantityOf(leche.id)).resolves.toBe(0.25);
		await expect(quantityOf(arroz.id)).resolves.toBe(400);
	});

	it('al llegar a 0 el producto SE QUEDA en la despensa, a cero', async () => {
		const familyId = await familyRow('Familia Que Acaba');
		const pan = await pantryRow(familyId, 'Pan', 1, 'unit');

		await expect(adjustPantryItem(familyId, pan.id, -1)).resolves.toBe(true);
		// Agotado no es borrado: la fila aguanta a 0, lista para re-añadirse.
		await expect(quantityOf(pan.id)).resolves.toBe(0);
	});

	it('clampa a 0 sin negativos: consumir más de lo que queda deja la cantidad en 0', async () => {
		const familyId = await familyRow('Familia Corta');
		const queso = await pantryRow(familyId, 'Queso', 0.1, 'kilogram');

		// 0,1 kg − paso 0,25 quedaría en −0,15: el clamp lo deja en 0.
		await expect(adjustPantryItem(familyId, queso.id, -1)).resolves.toBe(true);
		await expect(quantityOf(queso.id)).resolves.toBe(0);
		// Y sigue en el listado (agotado), que es la memoria para la compra.
		const items = await listPantryItems(familyId);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ name: 'Queso', quantity: 0 });
	});

	it('desde agotado, devolver (+) repone un paso', async () => {
		const familyId = await familyRow('Familia Que Repone');
		const pan = await pantryRow(familyId, 'Pan', 0, 'unit');

		await expect(adjustPantryItem(familyId, pan.id, 1)).resolves.toBe(true);
		await expect(quantityOf(pan.id)).resolves.toBe(1);
	});

	it('devolver (+) añade el paso de la unidad', async () => {
		const familyId = await familyRow('Familia Que Devuelve');
		const leche = await pantryRow(familyId, 'Leche entera', 1.5, 'liter');

		await expect(adjustPantryItem(familyId, leche.id, 1)).resolves.toBe(true);
		await expect(quantityOf(leche.id)).resolves.toBe(1.75);
	});

	it('un producto de otra familia no se puede ajustar (id ajeno es «no existe»)', async () => {
		const ownFamily = await familyRow('Familia Ajusta Propia');
		const otherFamily = await familyRow('Familia Ajusta Ajena');
		const caviar = await pantryRow(otherFamily, 'Caviar', 1, 'unit');

		await expect(adjustPantryItem(ownFamily, caviar.id, -1)).resolves.toBe(false);
		// La despensa ajena queda intacta.
		await expect(quantityOf(caviar.id)).resolves.toBe(1);
	});

	it('un id que no existe devuelve false', async () => {
		const familyId = await familyRow('Familia Fantasma');
		await expect(adjustPantryItem(familyId, 'no-existe', -1)).resolves.toBe(false);
	});
});

describe('Quitar un producto de la despensa (#148)', () => {
	it('borra la fila del todo, también la de un agotado a cero', async () => {
		const familyId = await familyRow('Familia Quita Agotados');
		const pan = await pantryRow(familyId, 'Pan', 0, 'unit');
		await pantryRow(familyId, 'Leche entera', 2, 'liter');

		await expect(removePantryItem(familyId, pan.id)).resolves.toBe(true);
		// La fila desaparece: agotado no vuelve a la lista de la compra solo.
		await expect(prisma.pantryItem.findUnique({ where: { id: pan.id } })).resolves.toBeNull();
		// Y el resto de la despensa queda intacto.
		await expect(listPantryItems(familyId)).resolves.toHaveLength(1);
	});

	it('quita también un producto con existencias (la confirmación va en la UI)', async () => {
		const familyId = await familyRow('Familia Quita Con Stock');
		const leche = await pantryRow(familyId, 'Leche entera', 1.5, 'liter');

		await expect(removePantryItem(familyId, leche.id)).resolves.toBe(true);
		await expect(listPantryItems(familyId)).resolves.toEqual([]);
	});

	it('un producto de otra familia no se puede quitar (id ajeno es «no existe»)', async () => {
		const ownFamily = await familyRow('Familia Quita Propia');
		const otherFamily = await familyRow('Familia Quita Ajena');
		const caviar = await pantryRow(otherFamily, 'Caviar', 1, 'unit');

		await expect(removePantryItem(ownFamily, caviar.id)).resolves.toBe(false);
		// La despensa ajena queda intacta.
		await expect(quantityOf(caviar.id)).resolves.toBe(1);
	});

	it('un id que no existe devuelve false', async () => {
		const familyId = await familyRow('Familia Quita Fantasma');
		await expect(removePantryItem(familyId, 'no-existe')).resolves.toBe(false);
	});
});

describe('Editar nombre, cantidad y unidad (#249, #289)', () => {
	it('cambia cantidad y unidad del producto, dejando el nombre como está', async () => {
		const familyId = await familyRow('Familia Editora');
		const lentejas = await pantryRow(familyId, 'Lentejas', 1, 'package');

		await expect(
			updatePantryItem(familyId, lentejas.id, {
				name: 'Lentejas',
				quantity: 1,
				unit: 'kilogram'
			})
		).resolves.toBe('updated');

		const row = await prisma.pantryItem.findUniqueOrThrow({ where: { id: lentejas.id } });
		expect(Number(row.quantity)).toBe(1);
		expect(row.unit).toBe('kilogram');
		// El nombre canónico no se toca: es el que la familia reconoce.
		expect(row.name).toBe('Lentejas');
		expect(row.normalizedName).toBe('lentejas');
	});

	it('el renombre persiste y recalcula el nombre canónico (#289)', async () => {
		const familyId = await familyRow('Familia Renombradora');
		// Sembrado a propósito SIN acentos colapsados en el canónico: el
		// renombre debe dejarlo consistente con `normalizeItemName`.
		const row = await prisma.pantryItem.create({
			data: {
				organizationId: familyId,
				name: 'Leche Entera  ',
				normalizedName: 'leche entera',
				quantity: 2,
				unit: 'liter'
			}
		});

		await expect(
			updatePantryItem(familyId, row.id, {
				// Tal y como llega del schema (zod ya hizo el trim): la acción le
				// pasa `form.data`, nunca el FormData crudo.
				name: 'Leche semidesnatada',
				quantity: 2,
				unit: 'liter'
			})
		).resolves.toBe('updated');

		const renamed = await prisma.pantryItem.findUniqueOrThrow({ where: { id: row.id } });
		// El nombre visible se guarda tal cual y el canónico se recalcula:
		// minúsculas, sin acentos y espacios colapsados.
		expect(renamed.name).toBe('Leche semidesnatada');
		expect(renamed.normalizedName).toBe('leche semidesnatada');
	});

	it('la colisión de unidad (mismo nombre) es duplicate, sin tocar nada (#249)', async () => {
		const familyId = await familyRow('Familia Colisionada');
		// «Lentejas» en paquete y «lentejas» en kg: mismo nombre canónico y
		// distinta unidad — exactamente el caso del modal (paquete → kg).
		const paquete = await pantryRow(familyId, 'Lentejas', 1, 'package');
		const granel = await pantryRow(familyId, 'lentejas', 0.3, 'kilogram');

		await expect(
			updatePantryItem(familyId, paquete.id, {
				name: 'Lentejas',
				quantity: 1,
				unit: 'kilogram'
			})
		).resolves.toBe('duplicate');

		// NINGUNA fila se tocó: ni la editada ni la ocupada.
		const editada = await prisma.pantryItem.findUniqueOrThrow({ where: { id: paquete.id } });
		expect(editada.name).toBe('Lentejas');
		expect(editada.unit).toBe('package');
		expect(Number(editada.quantity)).toBe(1);
		const ocupada = await prisma.pantryItem.findUniqueOrThrow({ where: { id: granel.id } });
		expect(ocupada.unit).toBe('kilogram');
		expect(Number(ocupada.quantity)).toBe(0.3);
	});

	it('renombrar a un nombre ocupado en la misma unidad es duplicate, sin tocar nada (#289)', async () => {
		const familyId = await familyRow('Familia Renombra Ocupado');
		const lacteo = await pantryRow(familyId, 'Lacteo', 1, 'liter');
		// «Leche entera» ya vive en litros: renombrar «Lacteo» a ese nombre
		// (mismo canónico, misma unidad) choca con el índice único.
		const ocupado = await pantryRow(familyId, 'Leche entera', 2, 'liter');

		await expect(
			updatePantryItem(familyId, lacteo.id, {
				name: 'Leche  Entera',
				quantity: 1,
				unit: 'liter'
			})
		).resolves.toBe('duplicate');

		// NINGUNA fila se tocó: ni la renombrada ni la ocupada.
		const quedo = await prisma.pantryItem.findUniqueOrThrow({ where: { id: lacteo.id } });
		expect(quedo.name).toBe('Lacteo');
		expect(quedo.normalizedName).toBe('lacteo');
		expect(quedo.unit).toBe('liter');
		expect(Number(quedo.quantity)).toBe(1);
		const leche = await prisma.pantryItem.findUniqueOrThrow({ where: { id: ocupado.id } });
		expect(leche.name).toBe('Leche entera');
		expect(leche.normalizedName).toBe('leche entera');
		expect(Number(leche.quantity)).toBe(2);
	});

	it('renombrar a sí mismo solo en mayúsculas o acentos no colisiona (#289)', async () => {
		const familyId = await familyRow('Familia Reescribe');
		const leche = await pantryRow(familyId, 'Leche entera', 2, 'liter');

		// Mismo canónico ('leche entera') y misma unidad: la única fila que
		// cumple la restricción única es la propia — no hay 409.
		await expect(
			updatePantryItem(familyId, leche.id, {
				name: 'LECHE ENTera',
				quantity: 2,
				unit: 'liter'
			})
		).resolves.toBe('updated');

		const row = await prisma.pantryItem.findUniqueOrThrow({ where: { id: leche.id } });
		expect(row.name).toBe('LECHE ENTera');
		// El canónico no cambia: es el mismo producto de siempre.
		expect(row.normalizedName).toBe('leche entera');
	});

	it('renombrar a un nombre ocupado en OTRA unidad sí vale (#289)', async () => {
		const familyId = await familyRow('Familia Renombra Otra Unidad');
		const paquete = await pantryRow(familyId, 'Lentejas de paquete', 1, 'package');
		await pantryRow(familyId, 'Lentejas', 0.3, 'kilogram');

		// El índice único es (familia, canónico, unidad): «Lentejas» en kg no
		// estorba a renombrar en paquete.
		await expect(
			updatePantryItem(familyId, paquete.id, {
				name: 'Lentejas',
				quantity: 1,
				unit: 'package'
			})
		).resolves.toBe('updated');

		const row = await prisma.pantryItem.findUniqueOrThrow({ where: { id: paquete.id } });
		expect(row.name).toBe('Lentejas');
		expect(row.normalizedName).toBe('lentejas');
		expect(row.unit).toBe('package');
	});

	it('el re-añadido usa el nombre NUEVO a partir del renombre (#289)', async () => {
		const familyId = await familyRow('Familia Renombre Readd');
		const list = await createList(familyId, LIST);
		const product = await pantryRow(familyId, 'Leche entera', 0, 'liter');
		await updatePantryItem(familyId, product.id, {
			name: 'Leche semidesnatada',
			quantity: 0,
			unit: 'liter'
		});

		await expect(
			readdPantryItem(familyId, product.id, { ...READD_BASE, listId: list.id, quantity: 1 })
		).resolves.toBe('added');

		const rows = await prisma.item.findMany({ where: { listId: list.id } });
		expect(rows).toHaveLength(1);
		// El item de la lista lleva el nombre renombrado, no el de la primera
		// compra.
		expect(rows[0].name).toBe('Leche semidesnatada');
	});

	it('un producto de otra familia no se puede editar (pantry-gone)', async () => {
		const ownFamily = await familyRow('Familia Edita Propia');
		const otherFamily = await familyRow('Familia Edita Ajena');
		const caviar = await pantryRow(otherFamily, 'Caviar', 1, 'unit');

		await expect(
			updatePantryItem(ownFamily, caviar.id, {
				name: 'Caviar',
				quantity: 2,
				unit: 'unit'
			})
		).resolves.toBe('pantry-gone');

		// La despensa ajena queda intacta.
		const row = await prisma.pantryItem.findUniqueOrThrow({ where: { id: caviar.id } });
		expect(Number(row.quantity)).toBe(1);
		expect(row.unit).toBe('unit');
	});

	it('un id que no existe devuelve pantry-gone', async () => {
		const familyId = await familyRow('Familia Edita Fantasma');
		await expect(
			updatePantryItem(familyId, 'no-existe', {
				name: 'Fantasma',
				quantity: 2,
				unit: 'unit'
			})
		).resolves.toBe('pantry-gone');
	});
});

describe('Recategorizar un producto (#176)', () => {
	it('fija la categoría del producto y el listado la muestra por id y nombre', async () => {
		const familyId = await familyRow('Familia Recategoriza');
		const dairy = await createCategory(familyId, { name: 'Lácteos' });
		const leche = await pantryRow(familyId, 'Leche entera', 2, 'liter');

		await expect(setPantryItemCategory(familyId, leche.id, dairy.id)).resolves.toBe('updated');

		const items = await listPantryItems(familyId);
		expect(items[0]).toMatchObject({
			name: 'Leche entera',
			categoryId: dairy.id,
			categoryName: 'Lácteos'
		});
	});

	it('con null quita la categoría: el producto queda sin ella', async () => {
		const familyId = await familyRow('Familia Descategoriza');
		const dairy = await createCategory(familyId, { name: 'Lácteos' });
		const leche = await pantryRow(familyId, 'Leche entera', 2, 'liter');
		await setPantryItemCategory(familyId, leche.id, dairy.id);

		await expect(setPantryItemCategory(familyId, leche.id, null)).resolves.toBe('updated');

		const items = await listPantryItems(familyId);
		expect(items[0]).toMatchObject({
			name: 'Leche entera',
			categoryId: null,
			categoryName: null
		});
	});

	it('un producto de otra familia no se puede recategorizar (pantry-gone)', async () => {
		const ownFamily = await familyRow('Familia Recat Propia');
		const otherFamily = await familyRow('Familia Recat Ajena');
		const caviar = await pantryRow(otherFamily, 'Caviar', 1, 'unit');
		const dairy = await createCategory(ownFamily, { name: 'Lácteos' });

		await expect(setPantryItemCategory(ownFamily, caviar.id, dairy.id)).resolves.toBe(
			'pantry-gone'
		);

		// El producto ajeno queda como estaba: sin categoría.
		const row = await prisma.pantryItem.findUniqueOrThrow({ where: { id: caviar.id } });
		expect(row.categoryId).toBeNull();
	});

	it('una categoría ajena o ya borrada es category-gone, sin tocar el producto', async () => {
		const ownFamily = await familyRow('Familia Recat Categoría');
		const otherFamily = await familyRow('Familia Recat Categoría Ajena');
		const pan = await pantryRow(ownFamily, 'Pan', 1, 'unit');
		const otherFamilyDairy = await createCategory(otherFamily, { name: 'Lácteos' });

		// El id ajeno no vale aunque la familia tenga el mismo nombre de categoría.
		await expect(setPantryItemCategory(ownFamily, pan.id, otherFamilyDairy.id)).resolves.toBe(
			'category-gone'
		);

		// Un id propio borrado mientras el modal estaba abierto tampoco.
		const fruits = await createCategory(ownFamily, { name: 'Frutas' });
		await deleteCategory(ownFamily, fruits.id);
		await expect(setPantryItemCategory(ownFamily, pan.id, fruits.id)).resolves.toBe(
			'category-gone'
		);

		// El producto nunca se tocó: sigue sin categoría.
		const items = await listPantryItems(ownFamily);
		expect(items[0]).toMatchObject({ name: 'Pan', categoryId: null, categoryName: null });
	});

	it('un id de producto que no existe devuelve pantry-gone', async () => {
		const familyId = await familyRow('Familia Recat Fantasma');
		const dairy = await createCategory(familyId, { name: 'Lácteos' });
		await expect(setPantryItemCategory(familyId, 'no-existe', dairy.id)).resolves.toBe(
			'pantry-gone'
		);
	});
});

/** Datos válidos según `listSchema`, para crear las listas de prueba. */
const LIST = { name: 'Compra semanal', color: 'yellow', icon: 'shopping-basket' } as const;

/** Datos válidos según `readdSchema`, para mutar campo a campo en cada spec. */
const READD_BASE = { quantity: 1 } as const;

describe('Re-añadir a la compra (#74)', () => {
	it('crea el item en la lista elegida con el nombre canónico de la despensa y el orden al final', async () => {
		const familyId = await familyRow('Familia Re-anadedora');
		const list = await createList(familyId, LIST);
		const product = await pantryRow(familyId, 'Leche entera', 2, 'liter');
		// Un item ya existente para comprobar que el nuevo va DETRÁS (order 1).
		await prisma.item.create({
			data: { listId: list.id, name: 'Pan', quantity: 1, unit: 'unit', order: 0 }
		});

		const outcome = await readdPantryItem(familyId, product.id, {
			...READD_BASE,
			listId: list.id,
			quantity: 2
		});

		expect(outcome).toBe('added');
		const rows = await prisma.item.findMany({
			where: { listId: list.id },
			orderBy: { order: 'asc' }
		});
		expect(rows).toHaveLength(2);
		expect(rows[1]).toMatchObject({
			name: 'Leche entera',
			unit: 'liter',
			purchased: false,
			order: 1
		});
		// La cantidad viaja como Decimal de la base: aplanada a número.
		expect(Number(rows[1].quantity)).toBe(2);
	});

	it('el item nuevo hereda la categoría del producto de despensa (#302)', async () => {
		const familyId = await familyRow('Familia Recategorizada');
		const list = await createList(familyId, LIST);
		const dairy = await createCategory(familyId, { name: 'Lácteos' });
		const product = await pantryRow(familyId, 'Leche entera', 2, 'liter');
		await prisma.pantryItem.update({
			where: { id: product.id },
			data: { categoryId: dairy.id }
		});

		await expect(
			readdPantryItem(familyId, product.id, { ...READD_BASE, listId: list.id, quantity: 1 })
		).resolves.toBe('added');

		const rows = await prisma.item.findMany({ where: { listId: list.id } });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ name: 'Leche entera', categoryId: dairy.id });
	});

	it('el item creado de un producto SIN categoría nace sin categoría', async () => {
		const familyId = await familyRow('Familia Sin Categorias');
		const list = await createList(familyId, LIST);
		const product = await pantryRow(familyId, 'Leche entera', 2, 'liter');

		await expect(
			readdPantryItem(familyId, product.id, { ...READD_BASE, listId: list.id, quantity: 1 })
		).resolves.toBe('added');

		const rows = await prisma.item.findMany({ where: { listId: list.id } });
		expect(rows).toHaveLength(1);
		expect(rows[0].categoryId).toBeNull();
	});

	it('al sumar sobre el pendiente equivalente, su categoría escrita se conserva', async () => {
		const familyId = await familyRow('Familia Que Suma');
		const list = await createList(familyId, LIST);
		const dairy = await createCategory(familyId, { name: 'Lácteos' });
		const drinks = await createCategory(familyId, { name: 'Bebidas' });
		const product = await pantryRow(familyId, 'Leche entera', 2, 'liter');
		await prisma.pantryItem.update({
			where: { id: product.id },
			data: { categoryId: dairy.id }
		});
		// El pendiente equivalente ya tiene SU categoría: la suma no la toca,
		// como tampoco toca su nombre escrito.
		const pending = await prisma.item.create({
			data: {
				listId: list.id,
				name: 'leche ENTERA',
				quantity: 0.5,
				unit: 'liter',
				categoryId: drinks.id,
				order: 0
			}
		});

		await expect(
			readdPantryItem(familyId, product.id, { ...READD_BASE, listId: list.id, quantity: 1 })
		).resolves.toBe('added');

		const rows = await prisma.item.findMany({ where: { listId: list.id } });
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(pending.id);
		expect(rows[0].categoryId).toBe(drinks.id);
		expect(Number(rows[0].quantity)).toBe(1.5);
	});

	it('suma la cantidad sobre el pendiente equivalente (mismo nombre normalizado y unidad)', async () => {
		const familyId = await familyRow('Familia Sumadora');
		const list = await createList(familyId, LIST);
		const product = await pantryRow(familyId, 'Leche entera', 2, 'liter');
		// Escrito distinto («leche ENTERA») pero mismo producto canónico.
		const pending = await prisma.item.create({
			data: { listId: list.id, name: 'leche ENTERA', quantity: 0.5, unit: 'liter', order: 0 }
		});

		const outcome = await readdPantryItem(familyId, product.id, {
			...READD_BASE,
			listId: list.id,
			quantity: 1
		});

		expect(outcome).toBe('added');
		// Una sola fila: se sumó sobre la existente, sin duplicado.
		const rows = await prisma.item.findMany({ where: { listId: list.id } });
		expect(rows).toHaveLength(1);
		// El nombre escrito se conserva: 0,5 + 1 = 1,5 L.
		expect(rows[0].name).toBe('leche ENTERA');
		expect(rows[0].unit).toBe('liter');
		expect(Number(rows[0].quantity)).toBe(1.5);
		expect(rows[0].id).toBe(pending.id);
	});

	it('no suma sobre los comprados: crea un item nuevo aunque el nombre coincida', async () => {
		const familyId = await familyRow('Familia Repetidora');
		const list = await createList(familyId, LIST);
		const product = await pantryRow(familyId, 'Leche entera', 2, 'liter');
		await prisma.item.create({
			data: {
				listId: list.id,
				name: 'Leche entera',
				quantity: 6,
				unit: 'liter',
				purchased: true,
				order: 0
			}
		});

		await expect(
			readdPantryItem(familyId, product.id, { ...READD_BASE, listId: list.id, quantity: 1 })
		).resolves.toBe('added');

		const rows = await prisma.item.findMany({ where: { listId: list.id } });
		expect(rows).toHaveLength(2);
		const newPending = rows.find((row) => !row.purchased);
		const purchased = rows.find((row) => row.purchased);
		expect(Number(newPending?.quantity)).toBe(1);
		expect(Number(purchased?.quantity)).toBe(6);
	});

	it('no suma si la unidad es distinta: mismo nombre pero en litros y en paquetes son productos distintos', async () => {
		const familyId = await familyRow('Familia De Unidades');
		const list = await createList(familyId, LIST);
		const product = await pantryRow(familyId, 'Leche', 2, 'liter');
		await prisma.item.create({
			data: { listId: list.id, name: 'Leche', quantity: 1, unit: 'package', order: 0 }
		});

		await expect(
			readdPantryItem(familyId, product.id, { ...READD_BASE, listId: list.id, quantity: 1 })
		).resolves.toBe('added');

		const rows = await prisma.item.findMany({ where: { listId: list.id } });
		expect(rows).toHaveLength(2);
	});

	it('la despensa queda como está: el re-añadido no la toca (#149)', async () => {
		const familyId = await familyRow('Familia Que Conserva');
		const list = await createList(familyId, LIST);
		const product = await pantryRow(familyId, 'Leche entera', 2, 'liter');

		await expect(
			readdPantryItem(familyId, product.id, { ...READD_BASE, listId: list.id, quantity: 1 })
		).resolves.toBe('added');

		const row = await prisma.pantryItem.findUniqueOrThrow({ where: { id: product.id } });
		expect(Number(row.quantity)).toBe(2);
	});

	it('un producto de otra despensa o una lista ajena no se dejan tocar', async () => {
		const ownFamily = await familyRow('Familia Cuidadosa');
		const otherFamily = await familyRow('Familia Ajena Readd');
		const otherFamilyList = await createList(otherFamily, LIST);
		const ownList = await createList(ownFamily, LIST);
		const foreignCaviar = await pantryRow(otherFamily, 'Caviar', 1, 'unit');

		// El producto de la despensa ajena no se ve aunque la lista sea mía.
		await expect(
			readdPantryItem(ownFamily, foreignCaviar.id, {
				...READD_BASE,
				listId: ownList.id,
				quantity: 1
			})
		).resolves.toBe('pantry-gone');

		// La lista ajena no es destino válido aunque el producto sea mío.
		const product = await pantryRow(ownFamily, 'Leche entera', 1, 'liter');
		await expect(
			readdPantryItem(ownFamily, product.id, {
				...READD_BASE,
				listId: otherFamilyList.id,
				quantity: 1
			})
		).resolves.toBe('list-gone');

		// Nada se movió.
		await expect(prisma.item.count({ where: { listId: ownList.id } })).resolves.toBe(0);
		await expect(prisma.item.count({ where: { listId: otherFamilyList.id } })).resolves.toBe(0);
	});

	it('un id de producto que no existe devuelve pantry-gone', async () => {
		const familyId = await familyRow('Familia Readd Fantasma');
		const list = await createList(familyId, LIST);
		await expect(
			readdPantryItem(familyId, 'no-existe', { ...READD_BASE, listId: list.id, quantity: 1 })
		).resolves.toBe('pantry-gone');
	});

	it('un agotado (a 0) también se puede re-añadir, y la despensa queda a 0', async () => {
		const familyId = await familyRow('Familia Agotada');
		const list = await createList(familyId, LIST);
		const product = await pantryRow(familyId, 'Leche entera', 0, 'liter');

		await expect(
			readdPantryItem(familyId, product.id, { ...READD_BASE, listId: list.id, quantity: 1 })
		).resolves.toBe('added');

		// La lista recibe el item y la despensa NO se rellena: el agotado
		// sigue agotado hasta que la compra vuelva a llenarlo (#149).
		await expect(prisma.item.count({ where: { listId: list.id } })).resolves.toBe(1);
		await expect(quantityOf(product.id)).resolves.toBe(0);
	});
});

// ---- Concurrencia del re-añadido (issue #108): dos miembros a la vez sobre
// la MISMA lista. El «buscar pendiente equivalente o crear» sin bloqueo
// creaba dos items; con el lock de la fila de lista, el segundo ve lo que el
// primero acaba de crear y suma. ----

describe('Re-añadidos concurrentes (#108)', () => {
	it('dos miembros re-añaden a la vez el mismo producto a la misma lista: un item, cantidad sumada', async () => {
		const familyId = await familyRow('Familia Re-añadida a la Vez');
		const list = await createList(familyId, LIST);
		const product = await pantryRow(familyId, 'Leche entera', 5, 'liter');

		const outcomes = await Promise.all([
			readdPantryItem(familyId, product.id, {
				...READD_BASE,
				listId: list.id,
				quantity: 1
			}),
			readdPantryItem(familyId, product.id, {
				...READD_BASE,
				listId: list.id,
				quantity: 2
			})
		]);
		expect(outcomes).toEqual(['added', 'added']);

		// UNA fila (la primera creó, la segunda sumó sobre ella): sin
		// duplicados y con 1 + 2 = 3 L.
		const rows = await prisma.item.findMany({ where: { listId: list.id } });
		expect(rows).toHaveLength(1);
		expect(Number(rows[0].quantity)).toBe(3);
		// La despensa quedó intacta: el re-añadido no la toca (#149).
		await expect(quantityOf(product.id)).resolves.toBe(5);
	});

	it('dos altas rápidas a la vez en la misma lista no repiten posición (`order`)', async () => {
		// El `max(order) + 1` sin lock daba el mismo `order` a los dos items,
		// que bailaban entre sí en el listado.
		const familyId = await familyRow('Familia Alta Doble');
		const list = await createList(familyId, LIST);

		const [first, second] = await Promise.all([
			createItem(familyId, list.id, { name: 'Pan', quantity: 1, unit: 'unit' }),
			createItem(familyId, list.id, { name: 'Leche', quantity: 1, unit: 'liter' })
		]);
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();

		// Dos items y posiciones DISTINCTAS 0 y 1: quién la tome depende de
		// quién gane el lock de la lista, pero nunca se repite.
		const orders = await prisma.item
			.findMany({ where: { listId: list.id }, orderBy: { order: 'asc' } })
			.then((rows) => rows.map((row) => row.order));
		expect(orders).toHaveLength(2);
		expect(orders).toEqual([0, 1]);
		expect(new Set(orders).size).toBe(2);
	});
});
