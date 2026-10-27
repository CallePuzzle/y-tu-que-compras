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
import { adjustPantryItem, listPantryItems } from './pantry.js';

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

/** Siembra un producto de despensa con los datos dados (lo que deja `finalizePurchase`). */
function pantryRow(
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
