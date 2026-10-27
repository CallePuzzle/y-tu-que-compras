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
import { listPantryItems } from './pantry.js';

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
