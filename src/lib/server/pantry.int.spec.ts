import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): `listPantryItems`
// (`$lib/server/pantry.ts`) contra un Postgres real con las migraciones
// aplicadas. Como en `lists.int.spec.ts`, las familias de prueba se crean
// directamente con Prisma (las filas de despensa solo cuelgan de la
// organización por FK, el plugin de tenancy no entra en el camino) y lo que se
// ejercita es la consulta con el filtro de familia — el criterio de la #44:
// la despensa muestra SOLO los productos de la familia activa, con la cantidad
// Decimal aplanada a número para la vista (#72).
import prisma from './prisma.js';
import { adjustPantryItem, listPantryItems, readdPantryItem } from './pantry.js';
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
		const mia = await familyRow('Familia Propia');
		const ajena = await familyRow('Familia Ajena');
		await pantryRow(mia, 'Leche entera', 1, 'liter');
		await pantryRow(ajena, 'Caviar', 1, 'unit');

		const items = await listPantryItems(mia);
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
async function cantidadDe(id: string): Promise<number | null> {
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
		await expect(cantidadDe(pan.id)).resolves.toBe(1);
		await expect(cantidadDe(leche.id)).resolves.toBe(0.25);
		await expect(cantidadDe(arroz.id)).resolves.toBe(400);
	});

	it('al llegar a 0 el producto desaparece', async () => {
		const familyId = await familyRow('Familia Que Acaba');
		const pan = await pantryRow(familyId, 'Pan', 1, 'unit');

		await expect(adjustPantryItem(familyId, pan.id, -1)).resolves.toBe(true);
		await expect(cantidadDe(pan.id)).resolves.toBeNull();
	});

	it('clampa a 0 sin negativos: consumir más de lo que queda borra el producto', async () => {
		const familyId = await familyRow('Familia Corta');
		const queso = await pantryRow(familyId, 'Queso', 0.1, 'kilogram');

		// 0,1 kg − paso 0,25 quedaría en −0,15: el clamp lo deja en 0 y borra.
		await expect(adjustPantryItem(familyId, queso.id, -1)).resolves.toBe(true);
		await expect(cantidadDe(queso.id)).resolves.toBeNull();
		// Y la despensa de la familia queda sin él.
		await expect(listPantryItems(familyId)).resolves.toEqual([]);
	});

	it('devolver (+) añade el paso de la unidad', async () => {
		const familyId = await familyRow('Familia Que Devuelve');
		const leche = await pantryRow(familyId, 'Leche entera', 1.5, 'liter');

		await expect(adjustPantryItem(familyId, leche.id, 1)).resolves.toBe(true);
		await expect(cantidadDe(leche.id)).resolves.toBe(1.75);
	});

	it('un producto de otra familia no se puede ajustar (id ajeno es «no existe»)', async () => {
		const mia = await familyRow('Familia Ajusta Propia');
		const ajena = await familyRow('Familia Ajusta Ajena');
		const caviar = await pantryRow(ajena, 'Caviar', 1, 'unit');

		await expect(adjustPantryItem(mia, caviar.id, -1)).resolves.toBe(false);
		// La despensa ajena queda intacta.
		await expect(cantidadDe(caviar.id)).resolves.toBe(1);
	});

	it('un id que no existe devuelve false', async () => {
		const familyId = await familyRow('Familia Fantasma');
		await expect(adjustPantryItem(familyId, 'no-existe', -1)).resolves.toBe(false);
	});
});

/** Datos válidos según `listSchema`, para crear las listas de prueba. */
const LISTA = { name: 'Compra semanal', color: 'primary', icon: 'shopping-basket' } as const;

/** Datos válidos según `readdSchema`, para mutar campo a campo en cada spec. */
const READD_BASE = { quantity: 1, pantryMode: 'keep' } as const;

describe('Re-añadir a la compra (#74)', () => {
	it('crea el item en la lista elegida con el nombre canónico de la despensa y el orden al final', async () => {
		const familyId = await familyRow('Familia Re-anadedora');
		const lista = await createList(familyId, LISTA);
		const producto = await pantryRow(familyId, 'Leche entera', 2, 'liter');
		// Un item ya existente para comprobar que el nuevo va DETRÁS (order 1).
		await prisma.item.create({
			data: { listId: lista.id, name: 'Pan', quantity: 1, unit: 'unit', order: 0 }
		});

		const outcome = await readdPantryItem(familyId, producto.id, {
			...READD_BASE,
			listId: lista.id,
			quantity: 2
		});

		expect(outcome).toBe('added');
		const filas = await prisma.item.findMany({
			where: { listId: lista.id },
			orderBy: { order: 'asc' }
		});
		expect(filas).toHaveLength(2);
		expect(filas[1]).toMatchObject({
			name: 'Leche entera',
			unit: 'liter',
			purchased: false,
			order: 1
		});
		// La cantidad viaja como Decimal de la base: aplanada a número.
		expect(Number(filas[1].quantity)).toBe(2);
	});

	it('suma la cantidad sobre el pendiente equivalente (mismo nombre normalizado y unidad)', async () => {
		const familyId = await familyRow('Familia Sumadora');
		const lista = await createList(familyId, LISTA);
		const producto = await pantryRow(familyId, 'Leche entera', 2, 'liter');
		// Escrito distinto («leche ENTERA») pero mismo producto canónico.
		const pendiente = await prisma.item.create({
			data: { listId: lista.id, name: 'leche ENTERA', quantity: 0.5, unit: 'liter', order: 0 }
		});

		const outcome = await readdPantryItem(familyId, producto.id, {
			...READD_BASE,
			listId: lista.id,
			quantity: 1
		});

		expect(outcome).toBe('added');
		// Una sola fila: se sumó sobre la existente, sin duplicado.
		const filas = await prisma.item.findMany({ where: { listId: lista.id } });
		expect(filas).toHaveLength(1);
		// El nombre escrito se conserva: 0,5 + 1 = 1,5 L.
		expect(filas[0].name).toBe('leche ENTERA');
		expect(filas[0].unit).toBe('liter');
		expect(Number(filas[0].quantity)).toBe(1.5);
		expect(filas[0].id).toBe(pendiente.id);
	});

	it('no suma sobre los comprados: crea un item nuevo aunque el nombre coincida', async () => {
		const familyId = await familyRow('Familia Repetidora');
		const lista = await createList(familyId, LISTA);
		const producto = await pantryRow(familyId, 'Leche entera', 2, 'liter');
		await prisma.item.create({
			data: {
				listId: lista.id,
				name: 'Leche entera',
				quantity: 6,
				unit: 'liter',
				purchased: true,
				order: 0
			}
		});

		await expect(
			readdPantryItem(familyId, producto.id, { ...READD_BASE, listId: lista.id, quantity: 1 })
		).resolves.toBe('added');

		const filas = await prisma.item.findMany({ where: { listId: lista.id } });
		expect(filas).toHaveLength(2);
		const pendienteNuevo = filas.find((fila) => !fila.purchased);
		const comprado = filas.find((fila) => fila.purchased);
		expect(Number(pendienteNuevo?.quantity)).toBe(1);
		expect(Number(comprado?.quantity)).toBe(6);
	});

	it('no suma si la unidad es distinta: mismo nombre pero en litros y en paquetes son productos distintos', async () => {
		const familyId = await familyRow('Familia De Unidades');
		const lista = await createList(familyId, LISTA);
		const producto = await pantryRow(familyId, 'Leche', 2, 'liter');
		await prisma.item.create({
			data: { listId: lista.id, name: 'Leche', quantity: 1, unit: 'package', order: 0 }
		});

		await expect(
			readdPantryItem(familyId, producto.id, { ...READD_BASE, listId: lista.id, quantity: 1 })
		).resolves.toBe('added');

		const filas = await prisma.item.findMany({ where: { listId: lista.id } });
		expect(filas).toHaveLength(2);
	});

	it('con «keep» la despensa queda como está', async () => {
		const familyId = await familyRow('Familia Que Conserva');
		const lista = await createList(familyId, LISTA);
		const producto = await pantryRow(familyId, 'Leche entera', 2, 'liter');

		await expect(
			readdPantryItem(familyId, producto.id, { ...READD_BASE, listId: lista.id, quantity: 1 })
		).resolves.toBe('added');

		const fila = await prisma.pantryItem.findUniqueOrThrow({ where: { id: producto.id } });
		expect(Number(fila.quantity)).toBe(2);
	});

	it('con «set» fija la cantidad que queda en la despensa', async () => {
		const familyId = await familyRow('Familia Que Fija');
		const lista = await createList(familyId, LISTA);
		const producto = await pantryRow(familyId, 'Leche entera', 2, 'liter');

		await expect(
			readdPantryItem(familyId, producto.id, {
				listId: lista.id,
				quantity: 1,
				pantryMode: 'set',
				newQuantity: 0.5
			})
		).resolves.toBe('added');

		const fila = await prisma.pantryItem.findUniqueOrThrow({ where: { id: producto.id } });
		expect(Number(fila.quantity)).toBe(0.5);
	});

	it('con «remove» quita el producto de la despensa', async () => {
		const familyId = await familyRow('Familia Que Quita');
		const lista = await createList(familyId, LISTA);
		const producto = await pantryRow(familyId, 'Leche entera', 2, 'liter');

		await expect(
			readdPantryItem(familyId, producto.id, {
				...READD_BASE,
				listId: lista.id,
				pantryMode: 'remove'
			})
		).resolves.toBe('added');

		await expect(prisma.pantryItem.findUnique({ where: { id: producto.id } })).resolves.toBeNull();
		await expect(listPantryItems(familyId)).resolves.toEqual([]);
	});

	it('un producto de otra despensa o una lista ajena no se dejan tocar', async () => {
		const mia = await familyRow('Familia Cuidadosa');
		const ajena = await familyRow('Familia Ajena Readd');
		const listaAjena = await createList(ajena, LISTA);
		const listaMia = await createList(mia, LISTA);
		const caviarAjeno = await pantryRow(ajena, 'Caviar', 1, 'unit');

		// El producto de la despensa ajena no se ve aunque la lista sea mía.
		await expect(
			readdPantryItem(mia, caviarAjeno.id, { ...READD_BASE, listId: listaMia.id, quantity: 1 })
		).resolves.toBe('pantry-gone');

		// La lista ajena no es destino válido aunque el producto sea mío.
		const producto = await pantryRow(mia, 'Leche entera', 1, 'liter');
		await expect(
			readdPantryItem(mia, producto.id, {
				...READD_BASE,
				listId: listaAjena.id,
				quantity: 1
			})
		).resolves.toBe('list-gone');

		// Nada se movió.
		await expect(prisma.item.count({ where: { listId: listaMia.id } })).resolves.toBe(0);
		await expect(prisma.item.count({ where: { listId: listaAjena.id } })).resolves.toBe(0);
	});

	it('un id de producto que no existe devuelve pantry-gone', async () => {
		const familyId = await familyRow('Familia Readd Fantasma');
		const lista = await createList(familyId, LISTA);
		await expect(
			readdPantryItem(familyId, 'no-existe', { ...READD_BASE, listId: lista.id, quantity: 1 })
		).resolves.toBe('pantry-gone');
	});
});
