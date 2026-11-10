import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): las funciones de
// `#lib/server/categories.ts` contra un Postgres real con las migraciones
// aplicadas. Como en `lists.int.spec.ts` no hacen falta sesiones: las familias
// de prueba se crean directamente con Prisma (el plugin de tenancy no entra en
// el camino) y lo que se ejercita es el CRUD con el filtro de familia activa —
// el criterio de la issue #169: cada familia gestiona solo lo suyo, los ids
// ajenos no se pueden tocar ni por error, y el duplicado se rechaza sobre el
// nombre NORMALIZADO con el P2002 traducido a `CategoryExistsError`. El
// borrado también verifica el SetNull prometido por la épica #164: los items
// y productos sobreviven sin categoría y el historial conserva su snapshot.
import type { CategoryData } from '#lib/schemas/category.js';
import prisma from './prisma.js';
import {
	CategoryExistsError,
	createCategory,
	deleteCategory,
	listCategories,
	reorderCategories,
	updateCategory
} from './categories.js';

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

/** Datos válidos según `categorySchema`, para mutar campo a campo en cada spec. */
const CATEGORY: CategoryData = { name: 'Lácteos' };

describe('CRUD de categorías por familia (#169)', () => {
	it('createCategory guarda nombre, canónico y posición al final del orden', async () => {
		const familyId = await familyRow('Familia Categorizadora');

		const first = await createCategory(familyId, CATEGORY);
		expect(first).toMatchObject({ name: 'Lácteos', position: 0 });

		// El canónico del duplicado lo calcula el SERVIDOR con el mismo
		// `normalizeItemName` de la despensa (épica #164): «Yogur  Natural»
		// colisiona con «yogur natural».
		const second = await createCategory(familyId, { name: 'Yogur  Natural' });
		expect(second.position).toBe(1);
		expect(await prisma.category.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
			normalizedName: 'yogur natural',
			organizationId: familyId
		});
	});

	it('createCategory rechaza el duplicado normalizado; otra familia sí puede tenerlo', async () => {
		const ownFamily = await familyRow('Familia Primera');
		const otherFamily = await familyRow('Familia Segunda');
		await createCategory(ownFamily, CATEGORY);

		// «lacteos» es el mismo canónico que «Lácteos»: el único
		// (familia, normalizedName) lo rechaza y sale como el error de dominio
		// que la acción traduce al mensaje de la UI (checklist #169).
		await expect(createCategory(ownFamily, { name: 'lacteos' })).rejects.toBeInstanceOf(
			CategoryExistsError
		);
		await expect(createCategory(ownFamily, { name: ' LÁCTEOS ' })).rejects.toBeInstanceOf(
			CategoryExistsError
		);

		// Sin fugas entre familias: el mismo nombre en OTRA familia es válido.
		const otherFamilyCategory = await createCategory(otherFamily, { name: 'LACTEOS' });
		expect(otherFamilyCategory.name).toBe('LACTEOS');
	});

	it('listCategories devuelve solo las de la familia, en su orden', async () => {
		const ownFamily = await familyRow('Familia Ordenada');
		const otherFamily = await familyRow('Familia Ajena');

		const dairy = await createCategory(ownFamily, CATEGORY);
		const frozen = await createCategory(ownFamily, { name: 'Congelados' });
		await createCategory(otherFamily, { name: 'Categoría secreta' });

		await reorderCategories(ownFamily, [frozen.id, dairy.id]);

		const categories = await listCategories(ownFamily);
		expect(categories.map((category) => category.id)).toEqual([frozen.id, dairy.id]);
		expect(categories[0]).toMatchObject({ name: 'Congelados', position: 0 });
		expect(categories[1]).toMatchObject({ name: 'Lácteos', position: 1 });
	});

	it('updateCategory renombra la propia; una ajena o inexistente devuelve false', async () => {
		const ownFamily = await familyRow('Familia Editora');
		const otherFamily = await familyRow('Familia Intacta');
		const ownCategory = await createCategory(ownFamily, CATEGORY);
		const externalFamily = await createCategory(otherFamily, CATEGORY);

		expect(await updateCategory(ownFamily, ownCategory.id, { name: 'Lácteos y derivados' })).toBe(
			true
		);
		expect(
			await prisma.category.findUniqueOrThrow({ where: { id: ownCategory.id } })
		).toMatchObject({
			name: 'Lácteos y derivados',
			normalizedName: 'lacteos y derivados'
		});

		// El id de una categoría de OTRA familia no se puede actualizar aunque
		// se conozca: el filtro de familia activa lo hace inalcanzable.
		expect(await updateCategory(ownFamily, externalFamily.id, { name: 'Vándalo' })).toBe(false);
		expect(
			(await prisma.category.findUniqueOrThrow({ where: { id: externalFamily.id } })).name
		).toBe('Lácteos');
		expect(await updateCategory(ownFamily, randomUUID(), CATEGORY)).toBe(false);
	});

	it('updateCategory rechaza el renombrado a un duplicado; renombrar al mismo nombre no choca', async () => {
		const familyId = await familyRow('Familia Renombradora');
		const dairy = await createCategory(familyId, CATEGORY);
		const frozen = await createCategory(familyId, { name: 'Congelados' });

		await expect(updateCategory(familyId, frozen.id, { name: 'lacteos' })).rejects.toBeInstanceOf(
			CategoryExistsError
		);
		// El rechazo no dejó una categoría a medias: congelados sigue intacta.
		expect(await prisma.category.findUniqueOrThrow({ where: { id: frozen.id } })).toMatchObject({
			name: 'Congelados'
		});

		// Renombrar al MISMO nombre (con espacios que el trim quita) pasa por el
		// único sin chocar consigo misma: Postgres ignora el update sin cambios.
		expect(await updateCategory(familyId, dairy.id, { name: ' Lácteos ' })).toBe(true);
	});

	it('reorderCategories reescribe las posiciones según el orden pedido', async () => {
		const familyId = await familyRow('Familia Reordenadora');
		const a = await createCategory(familyId, { name: 'Lácteos' });
		const b = await createCategory(familyId, { name: 'Congelados' });
		const c = await createCategory(familyId, { name: 'Droguería' });

		await reorderCategories(familyId, [c.id, a.id, b.id]);

		const categories = await listCategories(familyId);
		expect(categories.map((category) => category.id)).toEqual([c.id, a.id, b.id]);
		expect(categories.map((category) => category.position)).toEqual([0, 1, 2]);
	});

	it('reorderCategories ignora ids ajenos y conserva la posición de las que no vienen', async () => {
		const ownFamily = await familyRow('Familia Cautelosa');
		const otherFamily = await familyRow('Familia Imperturbable');
		const a = await createCategory(ownFamily, { name: 'Lácteos' });
		const b = await createCategory(ownFamily, { name: 'Congelados' });
		const externalFamily = await createCategory(otherFamily, { name: 'Ajena' });

		// Orden parcial: solo menciono «a» y un id AJENO. «b» no viene: conserva
		// su posición; la ajena no se toca aunque su id viaje en el array.
		await reorderCategories(ownFamily, [b.id, externalFamily.id, a.id, externalFamily.id]);

		expect(await listCategories(ownFamily)).toEqual([
			{ id: b.id, name: 'Congelados', position: 0 },
			{ id: a.id, name: 'Lácteos', position: 1 }
		]);
		expect(
			(await prisma.category.findUniqueOrThrow({ where: { id: externalFamily.id } })).position
		).toBe(0);
	});

	it('deleteCategory borra solo la propia; items y productos quedan sin categoría (SetNull)', async () => {
		const ownFamily = await familyRow('Familia Destructora');
		const otherFamily = await familyRow('Familia Superviviente');
		const ownCategory = await createCategory(ownFamily, CATEGORY);
		const externalFamily = await createCategory(otherFamily, CATEGORY);

		// Escenario con las tres FKs de la épica #164 apuntando a la categoría:
		// item de lista, producto de despensa y snapshot del historial.
		const list = await prisma.list.create({
			data: {
				organizationId: ownFamily,
				name: 'Compra semanal',
				color: 'yellow',
				icon: 'shopping-basket'
			}
		});
		const item = await prisma.item.create({
			data: {
				listId: list.id,
				name: 'Yogur',
				quantity: 4,
				unit: 'unit',
				order: 0,
				categoryId: ownCategory.id
			}
		});
		const product = await prisma.pantryItem.create({
			data: {
				organizationId: ownFamily,
				name: 'Yogur',
				normalizedName: 'yogur',
				quantity: 4,
				unit: 'unit',
				categoryId: ownCategory.id
			}
		});
		const purchase = await prisma.purchaseRecord.create({
			data: {
				organizationId: ownFamily,
				listName: 'Compra semanal',
				total: 10.5,
				items: {
					create: {
						position: 0,
						name: 'Yogur',
						quantity: 4,
						unit: 'unit',
						categoryId: ownCategory.id,
						categoryName: 'Lácteos'
					}
				}
			}
		});

		// La ajena no se puede borrar aunque se conozca su id…
		expect(await deleteCategory(ownFamily, externalFamily.id)).toBe(false);
		expect(await prisma.category.findUnique({ where: { id: externalFamily.id } })).not.toBeNull();
		expect(await deleteCategory(ownFamily, randomUUID())).toBe(false);

		// …y la propia sí: los rows sobreviven SIN categoría y el historial
		// conserva el nombre snapshot (el detalle nunca muestra un hueco).
		expect(await deleteCategory(ownFamily, ownCategory.id)).toBe(true);
		expect(await prisma.category.findUnique({ where: { id: ownCategory.id } })).toBeNull();
		expect(await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
			categoryId: null
		});
		expect(await prisma.pantryItem.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({
			categoryId: null
		});
		const snapshot = await prisma.purchaseItem.findFirstOrThrow({
			where: { purchaseRecordId: purchase.id }
		});
		expect(snapshot.categoryId).toBeNull();
		expect(snapshot.categoryName).toBe('Lácteos');
	});

	it('borrar la familia se lleva sus categorías (FK en cascada)', async () => {
		const familyId = await familyRow('Familia Evanescente');
		await createCategory(familyId, CATEGORY);
		await createCategory(familyId, { name: 'Congelados' });

		await prisma.organization.delete({ where: { id: familyId } });

		expect(await prisma.category.findMany({ where: { organizationId: familyId } })).toHaveLength(0);
	});
});
